"""Video creative fit — refit a finished video ad to a screen's real resolution.

Self-contained. Nothing here imports from app.blueprint / app.plate /
app.layout, and nothing there imports from here: the image path is untouched by
design, and video is a parallel path that shares only the config object.

    ffmpeg.py    the subprocess boundary — binary discovery, build assertion, run
    probe.py     ffprobe -> VideoProbe, with the colour-tag fallback heuristic
    encode.py    H.264 level arithmetic + the encode argument list
    render.py    the fast path (stretch / crop) — one ffmpeg invocation
    pipeline.py  orchestration + content-hash caching
    check.py     golden-frame colour harness + encode assertions (the test suite)
    schemas.py   VideoProbe, VideoVariant, FitMode
"""
