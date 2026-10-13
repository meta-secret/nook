# Password Strength Estimate

## Overview

The vault detail sheet shows a strength estimate beside a revealed password
or API key. nook-core owns the estimate so every host shows the same result.

## Behavior

- `PasswordStrengthLevel::estimate` multiplies the value's length by the
  bits of its character pool: lowercase (26), uppercase (26), digits (10),
  and other characters (33).
- Below 45 bits is **Weak**, below 70 bits is **Fair**, and 70 bits or more
  is **Strong**.
- The estimate is display-only. It does not block saving and is not a
  policy check; it never sees anything but the value the user revealed.
- Passwords generated with the default `PasswordGenerationOptions` estimate
  Strong.

## Boundary

- `password_strength_level(password)` is the wasm-bindgen export used by
  the web vault.
- The web app renders the level as a ten-segment meter with the character
  count; it adds no strength logic of its own.
