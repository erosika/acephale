# The Request Line -- listener-driven music
settings.server.telnet.set(true)
settings.server.telnet.port.set(1237)
settings.server.telnet.bind_addr.set("0.0.0.0")

queue = request.queue(id="request_queue")

# Faint hiss between tracks -- keeps the stream alive
static = noise(duration=0.0)
static = amplify(0.01, static)

music = mksafe(fallback(track_sensitive=false, [queue, static]))

output.icecast(
  %mp3(bitrate=192),
  host="icecast",
  port=8000,
  password="hackme",
  mount="/request",
  name="The Request Line",
  description="Your music, your way -- call in and we'll find or create it",
  music
)

output.file(
  %mp3(bitrate=192),
  "/archive/request/%Y-%m-%d/request-%Y%m%d-%H.mp3",
  music,
  reopen_on_metadata=fun(_) -> false
)
