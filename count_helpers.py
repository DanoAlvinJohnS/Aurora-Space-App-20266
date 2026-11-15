"""Weighted array aggregation: SQL grouped counts have the same effect as rows."""
import numpy as np


def grouped_sums(index, weights):
    """Group arbitrary integer indexes, preserving summed detection counts."""
    unique, inverse = np.unique(index, return_inverse=True)
    summed = np.bincount(inverse, weights=weights).astype(np.uint64)
    return unique, summed


def add_weighted(array, country_index, metric_index, weights):
    """Accumulate nonnegative detection counts into the specified 2-D array."""
    flat = country_index * array.shape[1] + metric_index
    summed = np.bincount(flat, weights=weights, minlength=array.size)
    array += summed.reshape(array.shape).astype(array.dtype)
