# Third-party notices

This project vendors the client-related source files from Snap7 1.4.3 at
commit `30f37da3114024a71ba93f7fd855c680b97a406f`:

https://github.com/davenardella/snap7

Snap7 is Copyright (C) 2013–2025 Davide Nardella and is licensed under the GNU
Lesser General Public License, version 3 or (at your option) any later version.
The upstream `gpl.txt` and `lgpl-3.0.txt` files are included under
`vendor/snap7/`.

The vendored `s7_partner.h` contains a source-compatible qualification of
Snap7's global `byte` type (`::byte`). This avoids ambiguity with `std::byte`
when the header is parsed in the C++17 Node addon build.

The binding code in this package is MIT-licensed. Distribution of a binary
that incorporates Snap7 must also satisfy the applicable LGPL requirements.
