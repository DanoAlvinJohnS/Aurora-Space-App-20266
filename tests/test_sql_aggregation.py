import unittest
import numpy as np
from sql_aggregate import grouped_query
from count_helpers import grouped_sums, add_weighted


class SqlAggregationTests(unittest.TestCase):
    def test_sql_query_groups_month_cell_sensor_confidence_daynight(self):
        query = grouped_query('dbo', 'firms_modis', {
            'latitude': 'latitude', 'longitude': 'longitude',
            'acq_date': 'acq_date', 'confidence': 'confidence',
            'daynight': 'daynight',
        }, sample_percent=.01)
        self.assertIn('COUNT_BIG(*) AS multiplicity', query)
        self.assertIn('GROUP BY cy, cx, yr, mon, cb, is_night', query)
        self.assertIn('TABLESAMPLE SYSTEM (0.0100000 PERCENT)', query)
        self.assertIn('TRY_CONVERT(float, conf)', query)
        self.assertIn('REPEATABLE (42)', query)

    def test_default_fields(self):
        query = grouped_query('dbo', 'x', {
            'latitude': 'latitude', 'longitude': 'longitude', 'acq_date': 'acq_date'
        })
        self.assertIn("'h' AS conf", query)
        self.assertIn("'D' AS dn", query)
        self.assertNotIn('TABLESAMPLE', query)

    def test_invalid_sampling_rejected(self):
        with self.assertRaises(ValueError):
            grouped_query('dbo', 'x', {'latitude':'x', 'longitude':'y', 'acq_date':'z'}, 101)

    def test_weighted_grid_matches_raw_expansion(self):
        compressed_index = np.array([4, 4, 2, 2, 4, 6])
        compressed_n = np.array([12, 3, 4, 7, 8, 1])
        raw_index = np.repeat(compressed_index, compressed_n)
        raw_u, raw_counts = np.unique(raw_index, return_counts=True)
        group_u, group_counts = grouped_sums(compressed_index, compressed_n)
        np.testing.assert_array_equal(group_u, raw_u)
        np.testing.assert_array_equal(group_counts, raw_counts)

    def test_country_stats_weighted_equal_raw(self):
        country = np.array([1, 0, 1, 0])
        years = np.array([0, 1, 1, 0])
        multiplicity = np.array([2, 7, 9, 11])
        array = np.zeros((2, 2), np.int64)
        add_weighted(array, country, years, multiplicity)
        expected = np.zeros_like(array)
        np.add.at(expected, (np.repeat(country, multiplicity), np.repeat(years, multiplicity)), 1)
        np.testing.assert_array_equal(array, expected)


if __name__ == '__main__':
    unittest.main()
