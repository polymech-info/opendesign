# Feature Cards — Page 1

````opendesign
canvas main 1920 1080
theme tanit-light
background uploads/backgrounds/dark-blue-abstract-v1.png

preset body font=Inter size=20 weight=400
preset caption font=Inter size=18 weight=500
preset card.soft fill=#ffffffd8 stroke=#ffffff80 radius=24
preset h3 font=Inter size=30 weight=650

widget feature-group w=420 h=220
  shape bg role=background x=0 y=0 w=100% h=100% preset=card.soft
  icon icon role=icon x=24 y=24 w=64 h=64
  txt title role=title x=108 y=24 w=280 h=38 style=h3
  txt caption role=caption x=108 y=64 w=280 h=26 style=caption
  txt body role=body x=24 y=112 w=370 h=84 style=body


use feature-group as=feature.chat x=120 y=70
feature.chat.bg.shadow={"x":0,"y":12,"blur":32,"color":"#00066"}
feature.chat.bg.glass=true
feature.chat.bg.fill=#0f172acc
feature.chat.bg.stroke=#475569
feature.chat.bg.strokeWidth=1
feature.chat.icon=message-circle
feature.chat.icon.fill=#60a5fa
feature.chat.title=Chat and AI
feature.chat.title.fill=#f8fafc
feature.chat.caption=Everyday assistance
feature.chat.caption.fill=#94a3b8
feature.chat.body=Chat, translate, create, and learn.
feature.chat.body.fill=#cbd5e1
use feature-group as=feature.files x=120 y=310
feature.files.bg.shadow={"x":0,"y":12,"blur":32,"color":"#00066"}
feature.files.bg.glass=true
feature.files.bg.fill=#0f172acc
feature.files.bg.stroke=#475569
feature.files.bg.strokeWidth=1
feature.files.icon=folder
feature.files.icon.fill=#60a5fa
feature.files.title=Files and content
feature.files.title.fill=#f8fafc
feature.files.caption=Everything in one place
feature.files.caption.fill=#94a3b8
feature.files.body=Find, review, and organize your files.
feature.files.body.fill=#cbd5e1
use feature-group as=feature.chat.copy x=120 y=550
feature.chat.copy.bg.fill=#0f172acc
feature.chat.copy.bg.stroke=#475569
feature.chat.copy.bg.strokeWidth=1
feature.chat.copy.bg.shadow={"x":0,"y":12,"blur":32,"color":"#00066"}
feature.chat.copy.bg.glass=true
feature.chat.copy.icon=shield
feature.chat.copy.icon.fill=#60a5fa
feature.chat.copy.title=Privacy & security
feature.chat.copy.title.fill=#f8fafc
feature.chat.copy.title.size=30
feature.chat.copy.caption=Protected by design
feature.chat.copy.caption.fill=#94a3b8
feature.chat.copy.body=Control access and keep your data safe.
feature.chat.copy.body.fill=#cbd5e1
use feature-group as=feature.local x=120 y=790
feature.local.bg.fill=#0f172acc
feature.local.bg.stroke=#475569
feature.local.bg.strokeWidth=1
feature.local.bg.shadow={"x":0,"y":12,"blur":32,"color":"#00066"}
feature.local.bg.glass=true
feature.local.icon=lock
feature.local.icon.fill=#60a5fa
feature.local.title=Local models
feature.local.title.fill=#f8fafc
feature.local.caption=Embedded and private
feature.local.caption.fill=#94a3b8
feature.local.body=llama.cpp, ONNX, and whisper.cpp.
feature.local.body.fill=#cbd5e1
````
