# The Morning Zoo -- talk + pop music via request queue
settings.server.telnet.set(true)
settings.server.telnet.port.set(1234)
settings.server.telnet.bind_addr.set("0.0.0.0")

queue = request.queue(id="zoo_queue")

# Faint hiss as fallback -- no dead air, no stale replays
static = noise(duration=0.0)
static = amplify(0.01, static)

radio = mksafe(fallback(track_sensitive=false, [queue, static]))

output.icecast(
  %mp3(bitrate=192),
  host="icecast",
  port=8000,
  password="hackme",
  mount="/zoo",
  name="The Morning Zoo",
  description="Two AI co-hosts who bicker about everything",
  radio
)

output.file(
  %mp3(bitrate=192),
  "/archive/zoo/%Y-%m-%d/zoo-%Y%m%d-%H.mp3",
  radio,
  reopen_on_metadata=fun(_) -> false
)
