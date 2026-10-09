# RAW / specialty codec compatibility testing

## Verified camera sample matrix (October 9, 2026)

The opt-in [GitHub Actions RAW corpus run](https://github.com/Chaython/ChaysPhotoStudio/actions/runs/37980488133)
**passed** real LibRaw sensor decoding for the following pinned files from
[f-spot/raw-samples](https://github.com/f-spot/raw-samples), source commit
`54425e2cd53ec17d5fd88ee3277d03f54bf1fe84`:

| Camera | Format | Sensor decode |
| --- | --- | --- |
| Sony A700 | ARW | Passed |
| Canon EOS 400D | CR2 | Passed |
| Leica M8 | DNG | Passed |
| Nikon D90 | NEF | Passed |
| Pentax K10D | PEF | Passed |
| Panasonic G1 | RW2 | Passed |

All six samples were downloaded transiently inside the runner, checked
against their expected Git blob hashes, and run through the direct
`decodeCameraRaw` path (not embedded JPEG previews). Tests verify dimensions,
RGBA sample length and nonconstant pixels. **This does not verify color
fidelity, metadata preservation, camera orientation, or untested compression
variants.** Public fixture availability and reuse terms are documented by
the sample repository; the RAWs are not redistributed with this project.

## Real-camera regression corpus

Synthetic decoder tests are useful for offsets and pixel math but **do not prove**
that an actual Canon, Nikon, Sony or other proprietary RAW sensor stream works.
Run the opt-in camera test with files you are allowed to use:

```sh
bun run raw-corpus:validate -- fixtures/raw/corpus.json
```

The manifest is a JSON object with a nonempty `samples` array. For example:

```json
{
  "samples": [
    {
      "file": "canon-cr3-full.CR3",
      "make": "Canon",
      "model": "Example body",
      "compression": "CR3 full RAW",
      "expect": "decode",
      "minWidth": 2000,
      "minHeight": 1500,
      "sha256": "replace-with-actual-64-character-sha256"
    },
    {
      "file": "sony-lossy.ARW",
      "make": "Sony",
      "model": "Example body",
      "compression": "lossy compressed ARW",
      "expect": "unsupported"
    }
  ]
}
```

Place each actual file next to the manifest; the runner does not download photos
or upload private metadata. An omitted or empty corpus is an error, **not a
pass**. It executes the LibRaw sensor decoder directly, never the JPEG preview
fallback, verifies returned geometry/pixel length and detects blank output.
Add a SHA-256 checksum for every long-term fixture. The example records above
are illustrative, **not tested cameras**.

A suitable public starting source is [raw.pixls.us](https://raw.pixls.us/),
which also identifies each file's license. Only redistribute samples with
suitable permissions. The published RAW corpus from [RevelRaw](https://revelraw.com/sample-raw-files)
is another possible source; always pin the file SHA-256 and verify its license.

Capture a representative matrix including DNG; Canon CR2/CR3 RAW and C-RAW;
Nikon NEF 12/14-bit uncompressed, lossy and lossless; Sony ARW uncompressed
and compressed; Fuji RAF lossless and compressed; Olympus ORF; Panasonic RW2;
Pentax PEF; Phase One IIQ; Hasselblad 3FR; and an unsupported or damaged sample.

For each real file, also perform a **visual** comparison against a reference
converter for orientation, white balance, clipped highlights, black level,
color fringing and edge cropping. Passing the pixel-count checks above is not
a proof of color correctness. Browser/desktop UI tests must verify the original
RAW survives a project save/reload and that redevelop changes pixels while
preserving transformations and Smart Filters.

## Other codecs

- EXR: run `bun run formats:validate` for synthetic scanline/RLE/tile/multipart
  cases. Before broader claims, use the official
  [OpenEXR sample suite](https://openexr.com/en/latest/test_images/) to check
  compression variants, multiresolution tiles, multipart and deep samples.
- DICOM: use de-identified, permitted files. Test single-frame and multiframe
  RLE/JPEG-LS/JPEG2000/JPEG baseline plus offset-table edge cases and reject
  inconsistent transfer syntaxes. Output is **display-only; not for diagnosis**.
- BPG: **no production decoder bundled yet**. Existing legacy JavaScript BPG
  implementations are unmaintained; enabling one without source, security,
  license and malformed-file fuzz testing would expose an image-decoding attack
  surface. Current file handling explicitly explains the missing decoder.
- Lens profiles: settings implement user-calibrated coefficients and can now
  import individual user-supplied Lensfun XML calibration files on demand.
  The Develop dialog conservatively auto-matches model/focal metadata when a
  unique lens is found; incompatible files or ambiguous lenses are rejected.
  The database is *not bundled*; full licensed Lensfun WASM maps and broad
  manufacturer calibration validation remain future work.

Never count extension recognition, embedded preview import or a passing
synthetic header as full support for proprietary formats.
