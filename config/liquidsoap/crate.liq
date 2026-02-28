# The Crate Digger -- deep-cut music with crossfade
settings.server.telnet.set(true)
settings.server.telnet.port.set(1235)
settings.server.telnet.bind_addr.set("0.0.0.0")

queue = request.queue(id="crate_queue")
music = mksafe(queue)

output.icecast(
  %mp3(bitrate=192),
  host="icecast",
  port=8000,
  password="hackme",
  mount="/crate",
  name="The Crate Digger",
  description="Obsessive music nerd pulling deep cuts from every decade and country",
  music
)

output.file(
  %mp3(bitrate=192),
  "/archive/crate/%Y-%m-%d/crate-%Y%m%d-%H.mp3",
  music,
  reopen_on_metadata=fun(_) -> false
)
