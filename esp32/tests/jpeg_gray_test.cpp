#include "../perch_esp32/jpeg_gray.h"

#include <stdio.h>

int main() {
  uint8_t gray[96 * 72];
  for (int y = 0; y < 72; y++) {
    for (int x = 0; x < 96; x++) gray[y * 96 + x] = x < 48 ? 10 : 240;
  }
  uint8_t jpeg[64 * 1024];
  const size_t size = jpeg_gray_encode(gray, 96, 72, 50, jpeg, sizeof(jpeg));
  if (size < 4 || jpeg[0] != 0xff || jpeg[1] != 0xd8 || jpeg[size - 2] != 0xff || jpeg[size - 1] != 0xd9) return 1;
  FILE* file = fopen("/tmp/gray.jpg", "wb");
  if (!file) return 1;
  fwrite(jpeg, 1, size, file);
  fclose(file);
  return 0;
}
