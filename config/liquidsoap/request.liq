# The Request Line -- listener-driven music
settings.server.telnet.set(true)
settings.server.telnet.port.set(1237)
settings.server.telnet.bind_addr.set("0.0.0.0")

queue = request.queue(id="request_queue")
music = mksafe(queue)

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
