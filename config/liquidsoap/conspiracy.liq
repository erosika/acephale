# The Conspiracy Hour -- talk over eerie ambient
settings.server.telnet.set(true)
settings.server.telnet.port.set(1236)
settings.server.telnet.bind_addr.set("0.0.0.0")

queue = request.queue(id="conspiracy_queue")
radio = mksafe(queue)

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

output.file(
  %mp3(bitrate=192),
  "/archive/conspiracy/%Y-%m-%d/conspiracy-%Y%m%d-%H.mp3",
  radio,
  reopen_on_metadata=fun(_) -> false
)
