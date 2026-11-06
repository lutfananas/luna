import urllib.request, zipfile, io, sys, os, re, ssl
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../data/sndk")
ctx = ssl.create_default_context(cafile='/root/.ccr/ca-bundle.crt')
B = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision?prefix="
def keys(prefix):
    x = urllib.request.urlopen(B + prefix, context=ctx, timeout=60).read().decode()
    return re.findall(r"<Key>([^<]*\.zip)</Key>", x)
out = {}
for tf in ['1h', '15m', '5m']:
    rows = {}
    mk = keys(f"data/futures/um/monthly/klines/SNDKUSDT/{tf}/")
    months = {re.search(r"(\d{4}-\d{2})\.zip", k).group(1) for k in mk}
    dk = [k for k in keys(f"data/futures/um/daily/klines/SNDKUSDT/{tf}/") if re.search(r"(\d{4}-\d{2})-\d{2}\.zip", k).group(1) not in months]
    for k in mk + dk:
        data = urllib.request.urlopen("https://data.binance.vision/" + k, context=ctx, timeout=60).read()
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for n in z.namelist():
                for line in z.read(n).decode().splitlines():
                    p = line.split(',')
                    if not p[0].isdigit(): continue
                    rows[int(p[0])] = p[:6]
    ts = sorted(rows)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f"SNDKUSDT-{tf}.csv"), "w") as f:
        f.write("time,open,high,low,close,volume\n")
        for t in ts: f.write(",".join(rows[t]) + "\n")
    print(tf, len(ts), len(mk), "bulan +", len(dk), "hari")
