#include "jpeg_gray.h"

#include <math.h>
#include <string.h>

namespace {

constexpr uint8_t kDcBits[16] = {0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0};
constexpr uint8_t kDcVal[12] = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11};
constexpr uint8_t kAcBits[16] = {0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d};
constexpr uint8_t kAcVal[162] = {
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
    0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
    0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
    0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
    0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
    0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
};
constexpr uint8_t kZigzag[64] = {
    0,  1,  8,  16, 9,  2,  3,  10, 17, 24, 32, 25, 18, 11, 4,  5,  12, 19, 26, 33, 40, 48,
    41, 34, 27, 20, 13, 6,  7,  14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23,
    30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
};
constexpr uint8_t kQuant[64] = {
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57,
    69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64,
    81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
};

struct Writer {
  uint8_t* out;
  size_t cap;
  size_t used;
  uint32_t acc;
  int bits;
  bool overflow;
};

void put(Writer* writer, uint8_t byte) {
  if (writer->used >= writer->cap) {
    writer->overflow = true;
    return;
  }
  writer->out[writer->used++] = byte;
}

void emit(Writer* writer, uint32_t value, int length) {
  if (length <= 0) return;
  writer->acc = (writer->acc << length) | (value & ((length == 32) ? 0xffffffffu : ((1u << length) - 1u)));
  writer->bits += length;
  while (writer->bits >= 8) {
    writer->bits -= 8;
    const uint8_t byte = static_cast<uint8_t>((writer->acc >> writer->bits) & 0xff);
    put(writer, byte);
    if (byte == 0xff) put(writer, 0x00);
  }
}

void flush_bits(Writer* writer) {
  if (writer->bits <= 0) return;
  const int pad = 8 - writer->bits;
  emit(writer, (1u << pad) - 1u, pad);
  writer->bits = 0;
  writer->acc = 0;
}

void build_codes(const uint8_t* bits, const uint8_t* values, int count, uint16_t* codes, uint8_t* sizes) {
  memset(codes, 0, sizeof(uint16_t) * 256);
  memset(sizes, 0, 256);
  uint16_t code = 0;
  int cursor = 0;
  for (int length = 1; length <= 16; length++) {
    for (int i = 0; i < bits[length - 1]; i++) {
      if (cursor < count) {
        const uint8_t symbol = values[cursor++];
        codes[symbol] = code;
        sizes[symbol] = static_cast<uint8_t>(length);
      }
      code++;
    }
    code = static_cast<uint16_t>(code << 1);
  }
}

int category(int value) {
  int magnitude = value < 0 ? -value : value;
  int cat = 0;
  while (magnitude) {
    magnitude >>= 1;
    cat++;
  }
  return cat;
}

void write_block(
    Writer* writer,
    const uint8_t* gray,
    int width,
    int x0,
    int y0,
    const uint8_t quant[64],
    int* dc,
    const uint16_t* dc_code,
    const uint8_t* dc_size,
    const uint16_t* ac_code,
    const uint8_t* ac_size) {
  float block[64];
  for (int y = 0; y < 8; y++) {
    for (int x = 0; x < 8; x++) block[y * 8 + x] = static_cast<float>(gray[(y0 + y) * width + (x0 + x)]) - 128.f;
  }
  for (int y = 0; y < 8; y++) {
    float row[8];
    for (int x = 0; x < 8; x++) row[x] = block[y * 8 + x];
    for (int u = 0; u < 8; u++) {
      float sum = 0;
      const float cu = u == 0 ? 0.70710678f : 1.f;
      for (int x = 0; x < 8; x++) sum += row[x] * cosf((2.f * x + 1.f) * u * 3.14159265f / 16.f);
      block[y * 8 + u] = 0.5f * cu * sum;
    }
  }
  for (int x = 0; x < 8; x++) {
    float col[8];
    for (int y = 0; y < 8; y++) col[y] = block[y * 8 + x];
    for (int v = 0; v < 8; v++) {
      float sum = 0;
      const float cv = v == 0 ? 0.70710678f : 1.f;
      for (int y = 0; y < 8; y++) sum += col[y] * cosf((2.f * y + 1.f) * v * 3.14159265f / 16.f);
      block[v * 8 + x] = 0.5f * cv * sum;
    }
  }

  int zz[64];
  for (int i = 0; i < 64; i++) {
    const int natural = kZigzag[i];
    const float scaled = block[natural] / static_cast<float>(quant[natural]);
    zz[i] = static_cast<int>(scaled >= 0 ? scaled + 0.5f : scaled - 0.5f);
  }

  const int diff = zz[0] - *dc;
  *dc = zz[0];
  const int dc_cat = category(diff);
  emit(writer, dc_code[dc_cat], dc_size[dc_cat]);
  if (dc_cat) {
    int bits = diff;
    if (diff < 0) bits = diff + (1 << dc_cat) - 1;
    emit(writer, static_cast<uint32_t>(bits), dc_cat);
  }

  int run = 0;
  for (int i = 1; i < 64; i++) {
    if (zz[i] == 0) {
      run++;
      continue;
    }
    while (run > 15) {
      emit(writer, ac_code[0xf0], ac_size[0xf0]);
      run -= 16;
    }
    const int ac_cat = category(zz[i]);
    const int symbol = (run << 4) | ac_cat;
    emit(writer, ac_code[symbol], ac_size[symbol]);
    int bits = zz[i];
    if (zz[i] < 0) bits = zz[i] + (1 << ac_cat) - 1;
    emit(writer, static_cast<uint32_t>(bits), ac_cat);
    run = 0;
  }
  if (run) emit(writer, ac_code[0x00], ac_size[0x00]);
}

void write_marker(Writer* writer, const uint8_t* bytes, size_t count) {
  for (size_t i = 0; i < count; i++) put(writer, bytes[i]);
}

}  // namespace

size_t jpeg_gray_encode(const uint8_t* gray, int width, int height, int quality, uint8_t* out, size_t out_cap) {
  if (!gray || !out || width <= 0 || height <= 0 || (width & 7) || (height & 7)) return 0;
  if (quality < 1) quality = 1;
  if (quality > 95) quality = 95;

  uint8_t quant[64];
  const int scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
  for (int i = 0; i < 64; i++) {
    int value = (kQuant[i] * scale + 50) / 100;
    if (value < 1) value = 1;
    if (value > 255) value = 255;
    quant[i] = static_cast<uint8_t>(value);
  }

  uint16_t dc_code[256];
  uint8_t dc_size[256];
  uint16_t ac_code[256];
  uint8_t ac_size[256];
  build_codes(kDcBits, kDcVal, 12, dc_code, dc_size);
  build_codes(kAcBits, kAcVal, 162, ac_code, ac_size);

  Writer writer{out, out_cap, 0, 0, 0, false};
  const uint8_t soi[] = {0xff, 0xd8};
  write_marker(&writer, soi, 2);

  uint8_t dqt[69];
  dqt[0] = 0xff;
  dqt[1] = 0xdb;
  dqt[2] = 0x00;
  dqt[3] = 67;
  dqt[4] = 0x00;
  for (int i = 0; i < 64; i++) dqt[5 + i] = quant[kZigzag[i]];
  write_marker(&writer, dqt, sizeof(dqt));

  uint8_t sof[13] = {0xff, 0xc0, 0x00, 11, 8};
  sof[5] = static_cast<uint8_t>((height >> 8) & 0xff);
  sof[6] = static_cast<uint8_t>(height & 0xff);
  sof[7] = static_cast<uint8_t>((width >> 8) & 0xff);
  sof[8] = static_cast<uint8_t>(width & 0xff);
  sof[9] = 1;
  sof[10] = 1;
  sof[11] = 0x11;
  sof[12] = 0;
  write_marker(&writer, sof, sizeof(sof));

  uint8_t dht_dc[5 + 16 + 12];
  dht_dc[0] = 0xff;
  dht_dc[1] = 0xc4;
  dht_dc[2] = 0x00;
  dht_dc[3] = static_cast<uint8_t>(3 + 16 + 12);
  dht_dc[4] = 0x00;
  memcpy(dht_dc + 5, kDcBits, 16);
  memcpy(dht_dc + 21, kDcVal, 12);
  write_marker(&writer, dht_dc, sizeof(dht_dc));

  uint8_t dht_ac[5 + 16 + 162];
  dht_ac[0] = 0xff;
  dht_ac[1] = 0xc4;
  dht_ac[2] = 0x00;
  dht_ac[3] = static_cast<uint8_t>((3 + 16 + 162) >> 8);
  dht_ac[3] = 0x00;
  dht_ac[4] = static_cast<uint8_t>(3 + 16 + 162);
  // Length is 2 + 1 + 16 + 162 = 181, which fits in one byte. The high length byte stays 0.
  dht_ac[2] = 0x00;
  dht_ac[3] = static_cast<uint8_t>((2 + 1 + 16 + 162) >> 8);
  dht_ac[4] = static_cast<uint8_t>(2 + 1 + 16 + 162);
  // Fix the mixup above: bytes 2-3 are the segment length, byte 4 is the table class.
  dht_ac[2] = 0x00;
  dht_ac[3] = static_cast<uint8_t>(2 + 1 + 16 + 162);
  dht_ac[4] = 0x10;
  memcpy(dht_ac + 5, kAcBits, 16);
  memcpy(dht_ac + 21, kAcVal, 162);
  write_marker(&writer, dht_ac, 5 + 16 + 162);

  const uint8_t sos[] = {0xff, 0xda, 0x00, 8, 1, 1, 0x00, 0x00, 0x3f, 0x00};
  write_marker(&writer, sos, sizeof(sos));

  int dc = 0;
  for (int y = 0; y < height; y += 8) {
    for (int x = 0; x < width; x += 8) {
      write_block(&writer, gray, width, x, y, quant, &dc, dc_code, dc_size, ac_code, ac_size);
    }
  }
  flush_bits(&writer);
  const uint8_t eoi[] = {0xff, 0xd9};
  write_marker(&writer, eoi, 2);
  if (writer.overflow) return 0;
  return writer.used;
}
