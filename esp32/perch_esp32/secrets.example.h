#pragma once

/* Copy this file to secrets.h in this same folder. secrets.h is not committed.
   Device id: letters, numbers, hyphens, or underscores, 1 to 80 characters.
   That id is what the home page asks for, and it is the user_id stored in Tiger Data.
   API base has no trailing slash.

   Wi-Fi is 2.4 GHz only. Use a home router or a phone hotspot.
   The name is 1 to 32 characters. The password is 0 to 64.
   An open network needs an empty password: "".
   A network that asks for a username (eduroam, campus, hotel login) will not connect.
   Escape a backslash or a double quote in the password (\ and \"). */

#define PERCH_WIFI_SSID "your-wifi"
#define PERCH_WIFI_PASSWORD "your-password"
#define PERCH_DEVICE_ID "lamp-1"
#define PERCH_PERCEPTRON_KEY "ak...."
#define PERCH_API_BASE "https://posture-api-x1my.onrender.com"
