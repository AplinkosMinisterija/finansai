# 01 — Kontekstas

## Problema

Aplinkos ministerijai pavaldžios institucijos (AAD, VSTT, LGT, RC, ir kitos) kasmet teikia finansavimo prašymus IT projektams, įrangos pirkimams, licencijų atnaujinimui, sistemos vystymui. Iki šiol procesas vyko per SharePoint sąrašą:

- Daug laukų vienoje eilutėje (~60+)
- Sunki navigacija ir filtravimas
- Permissions valdymas ribotas
- Ataskaitų formavimas — rankiniu būdu
- AM darbuotojai negali patogiai matyti tik už ką jie atsakingi
- Pavaldžios institucijos negali patogiai sekti savo prašymų būsenos

## Sprendimas — Finansai

Atskira vidinė web aplikacija su:

- **Tenant→User modeliu**: kiekviena institucija (įskaitant AM) yra atskiras tenant'as. Vartotojai priklauso vienai institucijai.
- **Vaidmenimis tenant'e**: `admin` (gali valdyti vartotojus savo institucijoje) ir `user` (gali tik teikti prašymus savo vardu).
- **AM specialiu vaidmeniu**: AM admin/user mato visas (arba pasirinktas) pavaldžių institucijų paraiškas ir gali jas tvirtinti / atmesti / grąžinti pataisymui.
- **Multi-step prašymo wizard'u**: vienas didelis prašymas suskaidytas į logines grupes (pagrindinė info → finansavimas → ketv. paskirstymas → atsakingi → peržiūra).
- **Ping-pong workflow**: jei prašyme yra netikslumų, AM gali grąžinti pataisymui su komentaru. Submitter pataiso ir vėl pateikia.

## Vartotojų rolės (Iter 1+ planas)

| Tenant     | Rolė        | Mato                                                  | Gali                                                              |
| ---------- | ----------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| AM         | `am_admin`  | Visus AM vartotojus + visas paraiškas iš visų tenant'ų | Valdyti AM vartotojus; tvirtinti/atmesti/grąžinti **visas** paraiškas |
| AM         | `am_user`   | AM vartotojus (read-only) + paraiškas iš priskirtų org'ų | Tvirtinti/atmesti/grąžinti **tik priskirtų** organizacijų paraiškas |
| Pavaldi    | `org_admin` | Savo org vartotojus + visus savo org prašymus         | Valdyti savo org vartotojus; teikti prašymus org vardu             |
| Pavaldi    | `org_user`  | **Tik savo** sukurtus prašymus                        | Teikti prašymus savo (=user) vardu                                |

## Kodėl atskira aplikacija, o ne kopija SharePoint?

- SharePoint license'ai brangūs ir nedraugiški automatizacijai
- Ataskaitos ir analitika natūralesnės SQL
- Wizard UX neįmanomas su SharePoint defaults
- BIIP stack'as jau veikia AM — pažįstamas infra, deploy, auth pattern'ai
- Ilgalaikiškai bus pigiau ir patogiau plėsti (ketv. ataskaitos, metinė ataskaita, Power BI dashboard'ai)
