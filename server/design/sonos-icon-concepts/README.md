# Sonos icon tracing

The production Sonos SVGs are generated from `chibi-reference.png` with the
MIT-licensed VTracer 1.0.0 alpha 4 Python package.

```powershell
python -m pip install vtracer==1.0.0a4
python .\vectorize_reference.py
```

Open `vector-candidates/preview.html` to inspect the resulting SVG paths at
25% through 800% zoom. The script also renders untracked 40 px and 290 px PNG
contact sheets using the server's existing Sharp dependency.
