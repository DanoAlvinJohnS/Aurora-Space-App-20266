"""Read-only Azure SQL GROUP BY query for TeraFlare's 0.5-degree/month grid.

The output is a lossless count representation for fire.bin and the country
summary when no brightness columns exist. Brightness/temperature data must use
the raw path; this query deliberately does not invent temperatures.
"""
import math


def grouped_query(schema, table, columns, sample_percent=0):
    """Return a read-only query giving representative bin centers + multiplicity.

    A sample is ONLY for smoke tests, never for published global totals.
    Table/column identifiers come from SQL metadata, not untrusted CLI input.
    """
    if not {'latitude', 'longitude', 'acq_date'} <= set(columns):
        raise ValueError('Missing mandatory FIRMS columns')
    if not math.isfinite(sample_percent) or sample_percent < 0 or sample_percent > 100:
        raise ValueError('sample_percent must be 0..100')

    def qi(identifier):
        return '[' + identifier.replace(']', ']]') + ']'

    conf = f'CAST({qi(columns["confidence"])} AS varchar(20))' if 'confidence' in columns else "'h'"
    night = f'CAST({qi(columns["daynight"])} AS varchar(5))' if 'daynight' in columns else "'D'"
    sample = (f' TABLESAMPLE SYSTEM ({sample_percent:.7f} PERCENT) REPEATABLE (42)'
              if sample_percent else '')
    return f"""
WITH cleaned AS (
    SELECT
        TRY_CAST({qi(columns['latitude'])} AS float) AS lat,
        TRY_CAST({qi(columns['longitude'])} AS float) AS lon,
        CONVERT(varchar(10), {qi(columns['acq_date'])}, 23) AS dt,
        {conf} AS conf,
        {night} AS dn
    FROM {qi(schema)}.{qi(table)}{sample}
), bucketed AS (
    SELECT
        TRY_CONVERT(int, LEFT(dt, 4)) AS yr,
        TRY_CONVERT(int, SUBSTRING(dt, 6, 2)) AS mon,
        CAST(CASE WHEN lat >= 90 THEN 0 WHEN lat <= -90 THEN 359
             ELSE FLOOR((90.0 - lat) * 2.0) END AS int) AS cy,
        CAST(CASE WHEN lon <= -180 THEN 0 WHEN lon >= 180 THEN 719
             ELSE FLOOR((lon + 180.0) * 2.0) END AS int) AS cx,
        CASE
            WHEN TRY_CONVERT(float, conf) IS NOT NULL THEN
                CASE WHEN TRY_CONVERT(float, conf) < 30 THEN 0
                     WHEN TRY_CONVERT(float, conf) < 80 THEN 1 ELSE 2 END
            WHEN LOWER(LEFT(LTRIM(RTRIM(conf)), 1)) = 'l' THEN 0
            WHEN LOWER(LEFT(LTRIM(RTRIM(conf)), 1)) = 'n' THEN 1
            ELSE 2 END AS cb,
        CASE WHEN UPPER(LEFT(LTRIM(RTRIM(dn)), 1)) = 'N' THEN 1 ELSE 0 END AS is_night
    FROM cleaned
    WHERE lat IS NOT NULL AND lon IS NOT NULL
)
SELECT
    CAST(89.75 - cy * 0.5 AS float) AS latitude,
    CAST(-179.75 + cx * 0.5 AS float) AS longitude,
    CONVERT(varchar(4), yr) + '-' + RIGHT('0' + CONVERT(varchar(2), mon), 2) + '-01' AS acq_date,
    CASE cb WHEN 0 THEN '0' WHEN 1 THEN '50' ELSE '90' END AS confidence,
    CASE is_night WHEN 1 THEN 'N' ELSE 'D' END AS daynight,
    COUNT_BIG(*) AS multiplicity
FROM bucketed
WHERE yr BETWEEN 2000 AND 2039 AND mon BETWEEN 1 AND 12
GROUP BY cy, cx, yr, mon, cb, is_night
"""
