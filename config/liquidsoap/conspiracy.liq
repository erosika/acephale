# The Conspiracy Hour -- talk over eerie ambient
settings.server.telnet.set(true)
settings.server.telnet.port.set(1236)

queue = request.queue(id="conspiracy_queue")
radio = fallback([queue, blank()])
radio = normalize(radio)

output.icecast(
  %mp3(bitrate=192),
  host="icecast",
  port=8000,
  password="hackme",
  mount="/conspiracy",
  name="The Conspiracy Hour",
  description="Late-night paranoid talk radio -- the truth is in the static",
  radio
)
