# The Request Line -- listener-driven music
settings.server.telnet.set(true)
settings.server.telnet.port.set(1237)

queue = request.queue(id="request_queue")
music = fallback([queue, blank()])
music = crossfade(music)
music = normalize(music)

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
