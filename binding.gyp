{
  "targets": [
    {
      "target_name": "snap7",
      "sources": [
        "src/addon.cpp",
        "vendor/snap7/src/sys/snap_msgsock.cpp",
        "vendor/snap7/src/sys/snap_sysutils.cpp",
        "vendor/snap7/src/sys/snap_threads.cpp",
        "vendor/snap7/src/core/s7_client.cpp",
        "vendor/snap7/src/core/s7_isotcp.cpp",
        "vendor/snap7/src/core/s7_micro_client.cpp",
        "vendor/snap7/src/core/s7_peer.cpp",
        "vendor/snap7/src/core/s7_text.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "vendor/snap7/src/sys",
        "vendor/snap7/src/core"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "libraries": [
              "ws2_32.lib",
              "winmm.lib"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "AdditionalOptions": [
                  "/std:c++17",
                  "/EHsc"
                ]
              }
            }
          }
        ],
        [
          "OS=='linux'",
          {
            "cflags_cc": [
              "-std=c++17",
              "-fexceptions"
            ],
            "libraries": [
              "-lpthread",
              "-lrt"
            ]
          }
        ]
      ]
    }
  ]
}
