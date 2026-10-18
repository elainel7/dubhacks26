#pragma once

#include <stddef.h>
#include <stdint.h>

/* Baseline grayscale JPEG. width and height must be multiples of 8.
   Returns the encoded size, or 0 if the output buffer is too small. */
size_t jpeg_gray_encode(
    const uint8_t* gray,
    int width,
    int height,
    int quality,
    uint8_t* out,
    size_t out_cap);
