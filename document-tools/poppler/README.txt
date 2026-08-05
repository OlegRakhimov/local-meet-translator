This directory is populated during the Windows release build with the Poppler pdftotext runtime.
Do not commit third-party binaries here. The build script copies pdftotext.exe and its adjacent DLLs from the installed Poppler package, validates the executable, and electron-builder bundles the directory into resources/document-tools/poppler.
