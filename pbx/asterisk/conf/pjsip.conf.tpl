; GT-ATS — PJSIP. ავტორი: Giorgi Turmanidze "GT"
[global]
type = global
user_agent = GT-ATS
endpoint_identifier_order = ip,username

[transport-udp]
type = transport
protocol = udp
bind = 0.0.0.0:5060
external_media_address = @@PUBLIC_IP@@
external_signaling_address = @@PUBLIC_IP@@
local_net = 127.0.0.0/8
local_net = 10.0.0.0/8
local_net = 172.16.0.0/12
local_net = 192.168.0.0/16

[transport-ws]
type = transport
protocol = ws
bind = 0.0.0.0

; ოპერატორის ბრაუზერის ტელეფონი (WebRTC)
[webrtc-op](!)
type = endpoint
transport = transport-ws
context = from-internal
disallow = all
allow = opus,ulaw,alaw
webrtc = yes
dtls_auto_generate_cert = yes
direct_media = no
device_state_busy_at = 1
allow_subscribe = no
dtmf_mode = rfc4733

#include pjsip_trunk.conf
#include pjsip_endpoints.conf
