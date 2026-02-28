# The Crate Digger -- deep-cut music with crossfade
settings.server.telnet.set(true)
settings.server.telnet.port.set(1235)

queue = request.queue(id="crate_queue")
music = fallback([queue, blank()])
music = crossfade(music)
music = normalize(music)

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
