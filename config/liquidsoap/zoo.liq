# The Morning Zoo -- talk + pop music via request queue
settings.server.telnet.set(true)
settings.server.telnet.port.set(1234)

episodes = playlist("/episodes", mode="normal", reload_mode="watch")
queue = request.queue(id="zoo_queue")

radio = fallback([queue, episodes, blank()])
radio = normalize(radio)

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
