**Techninis užsakymas**

Finansų valdymo modulis (FVM)

Papildymai finansai.biip.lt ir naujas finansų sekimo sluoksnis

*Versija 0.1*

**1. Kontekstas ir tikslas**

Finansai.biip.lt sistema šiuo metu valdo finansavimo prašymų srautą tarp
pavaldžių institucijų ir Aplinkos ministerijos (AM). Sistema žino
prašomą sumą ir jos statusą, tačiau neturi biudžeto valdymo logikos ---
neskaidoma pagal finansavimo šaltinius, nekaupiamos faktinės išlaidos,
nesekamas likutis.

Šis užsakymas aprašo du darbo srautus:

-   1 srautas --- minimalūs pakeitimai esamai sistemai: prašymo modelis
    papildomas biudžeto laukais, kad patvirtinta suma taptų naudinga
    tolesniam sekimui.

-   2 srautas --- naujas finansų sekimo sluoksnis (FVM): hierarchinis
    biudžeto modelis, išlaidų kaupimas, DU paskirstymas, spec. programų
    valdymas.

  -----------------------------------------------------------------------
  **Principas:** Esamas prašymų workflow nekeičiamas. Papildomi tik
  duomenų laukai. Visas naujas funkcionalumas --- atskiri servisai ir
  puslapiai.

  -----------------------------------------------------------------------

**2. Finansų hierarchijos modelis**

Visa finansų logika remiasi trijų lygių hierarchija. Kiekvienas lygis
atsako į skirtingą klausimą.

  ----------- ----------------- ---------------------- ----------------------
  **Lygis**   **Klausimas**     **Pavyzdys**           **Objektas DB**

  1 lygis     Iš kur pinigai?   Valstybės biudžetas,   funding_source
                                ES fondai, EEE         

  2 lygis     Kam skiriama?     DU fondas, Spec.       budget_allocation
                                programa A, Prekės ir  
                                paslaugos              

  3 lygis     Kas konkrečiai    Projektas, Spec.       project / activity
              išleidžia?        programa, Skyriaus     
                                veikla                 
  ----------- ----------------- ---------------------- ----------------------

**2.1 Finansavimo šaltiniai (1 lygis)**

Šaltiniai žinomi metų pradžioje. Keičiasi retai. Tai statiniai įrašai su
metine suma.

-   Valstybės biudžetas --- pagrindinis šaltinis, skaidomas pagal
    paskirtį

-   ES fondai --- projektinis finansavimas, griežtas atskaitingumas

-   Kiti šaltiniai --- EEE, NATO, rinkliavos (retai, bet sistema turi
    palaikyti)

  -----------------------------------------------------------------------
  **DB objektas: funding_source** id, tenant_id, pavadinimas, kodas,
  tipas (biudžetas \| ES \| kita), metinė_suma, metai, aktyvus

  -----------------------------------------------------------------------

**2.2 Biudžeto paskirstymas (2 lygis)**

Kaip konkretus šaltinis skaidomas pagal paskirtį. Vienas šaltinis gali
turėti kelias paskirstymo eilutes.

-   Darbo užmokestis (DU) --- atlyginimai ir priedai

-   Spec. programos --- kiekviena programa yra atskira eilutė (bent 4)

-   Prekės ir paslaugos --- veiklos išlaidos (įskaitant skyriaus mokymų
    atveją)

-   Investicijos ir kita --- kapitalinės išlaidos

  -----------------------------------------------------------------------
  **DB objektas: budget_allocation** id, funding_source_id, kategorija
  (enum), pavadinimas, planuota_suma, metai

  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  **Svarbu:** Administracinio skyriaus mokymai --- tai budget_allocation
  įrašas: šaltinis = valstybės biudžetas, kategorija =
  prekės_ir_paslaugos. Ne atskiras šaltinis, ne spec. programa.

  -----------------------------------------------------------------------

**2.3 Spec. programos --- išskirtinis atvejis**

Spec. programos yra 2 lygio objektai, tačiau turi papildomą savybę ---
finansavimo tipą, kuris lemia kaip jos finansuojamos.

  ----------------- ------------------ ------------------ ---------------
  **Tipas**         **Finansavimas**   **Ryšys su         **Biudžetas**
                                       prašymu**          

  Su atskiru        Rinkliavos,        Prašymas dėl šių   Atskira suma,
  finansavimu       mokesčiai, spec.   lėšų naudojimo     neįeina į
                    fondai                                bendrąjį
                                                          biudžetą

  Iš bendrojo       Dalis valstybės    Prašymas dėl lėšų  Atskira eilutė
  biudžeto          biudžeto           skyrimo iš         bendrame
                                       biudžeto           biudžete
  ----------------- ------------------ ------------------ ---------------

Abiem atvejais spec. programa gyvena tą patį ciklą:

-   Prašymas teikiamas per finansai.biip.lt (esamas workflow)

-   AM patvirtina --- nurodoma konkreti suma

-   Patvirtinta suma automatiškai tampa spec. programos biudžetu FVM
    sistemoje

-   Programa vykdoma --- kaupiamos faktinės išlaidos

-   Metų pabaigoje generuojama ataskaita: planas vs faktinis

  -----------------------------------------------------------------------
  **Ryšys:** Spec. programa FVM turi lauką request_id → finansai.biip.lt
  prašymo ID. Patvirtinus prašymą, FVM automatiškai (arba vienu mygtuku)
  sukuria programos įrašą su užpildytu biudžetu.

  -----------------------------------------------------------------------

**2.4 Projektai ir veiklos (3 lygis)**

3 lygio objektai --- tai kas faktiškai naudoja biudžetą. Du potipiai,
bet ta pati DB struktūra:

  -------------- ---------------------- ----------------- -------------------
  **Potipis**    **Pavyzdys**           **Šaltinis**      **Biudžetas iš**

  Projektas      IT infrastruktūros     ES fondai arba    budget_allocation
                 modernizavimas         biudžetas         eilutė

  Spec. programa Saugomų teritorijų     Atskiras arba     Patvirtinto prašymo
                 priežiūros programa    biudžeto dalis    suma

  Skyriaus       Darbuotojų mokymai     Valstybės         Prekių ir paslaugų
  veikla         2025                   biudžetas         eilutė
  -------------- ---------------------- ----------------- -------------------

  -----------------------------------------------------------------------
  **DB objektas: project** id, tenant_id, pavadinimas, tipas (projektas
  \| spec_programa \| veikla), budget_allocation_id, request_id (null jei
  ne spec. programa), biudžetas, pradžia, pabaiga, statusas

  -----------------------------------------------------------------------

**3. Pakeitimai esamai sistemai (finansai.biip.lt)**

  -----------------------------------------------------------------------
  **Apimtis:** Minimalūs pakeitimai. Esamas prašymų workflow, rolių
  modelis ir UI struktūra nekeičiami. Tik papildomi duomenų laukai ir
  vienas naujas wizard žingsnis.

  -----------------------------------------------------------------------

**3.1 Prašymo modelio papildymai**

Esama requests lentelė papildoma naujais laukais, reikalingais FVM
integracijai:

  --------------------------- ----------- ---------------------------------------
  **Naujas laukas**           **Tipas**   **Paskirtis**

  budget_category             enum        Kokiai biudžeto kategorijai prašoma
                                          (DU, spec_programa, prekes_paslaugos,
                                          kita)

  funding_source_type         enum        Finansavimo šaltinis: biudžetas \| ES
                                          \| kita

  spec_program_funding_type   enum \|     Tik spec. programoms: atskiras \|
                              null        biudžeto_dalis

  approved_amount             decimal \|  AM patvirtinta suma (užpildoma
                              null        patvirtinant)

  fvm_project_id              uuid \|     Ryšys su FVM projektu (užpildoma
                              null        sukūrus)
  --------------------------- ----------- ---------------------------------------

**3.2 Wizard papildymas (institucijos pusė)**

Esamo 5 žingsnių wizard\'o paskutinis žingsnis (peržiūra) papildomas
arba įterpiamas papildomas žingsnis --- biudžeto informacija:

-   Institucija pasirenka biudžeto kategoriją (dropdown)

-   Jei kategorija = spec. programa --- papildomas klausimas apie
    finansavimo tipą

-   Jei tipas = atskiras finansavimas --- galimybė nurodyti finansavimo
    šaltinį

-   Visi laukai neprivalomi atgaliniam suderinamumui --- seni prašymai
    veikia be pakeitimų

**3.3 Patvirtinimo ekranas (AM pusė)**

AM specialisto patvirtinimo ekranas papildomas:

-   Rodomas institucijos nurodytas biudžeto kategorijos pasirinkimas

-   AM gali patvirtinti arba koreguoti kategoriją

-   Patvirtinant nurodoma konkreti suma (approved_amount)

-   Po patvirtinimo --- mygtukas arba automatinis veiksmas: \'Sukurti
    FVM projektą\'

**3.4 Dashboard statistikos papildymas**

Esamas dashboard.service.ts papildomas naujais agregavimais:

-   Prašymų suskirstymas pagal biudžeto kategoriją

-   Patvirtintų sumų suvestinė pagal šaltinį

-   Procentas prašymų, kuriems sukurtas FVM projektas

**4. Nauji FVM servisai ir funkcionalumas**

  -----------------------------------------------------------------------
  **Architektūra:** Visi nauji servisai --- Moleculer.js, toje pačioje
  finansai/ repoje. Naujos DB migracijos, neliečiančios esamų lentelių.
  Bendras auth ir tenants.

  -----------------------------------------------------------------------

**4.1 budget.service.ts --- biudžeto valdymas**

Pagrindinis naujas servisas. Valdo finansavimo šaltinius ir paskirstymą.

**Funkcijos:**

-   Finansavimo šaltinių CRUD (funding_source) --- AM administratorius
    kuria metų pradžioje

-   Biudžeto eilučių valdymas (budget_allocation) --- šaltinio skaidymas
    pagal kategorijas

-   Planuotos sumos įvedimas ir keitimas

-   Automatinis likučio skaičiavimas: planuota − faktinė = likutis

-   Įspėjimai kai faktinė \> 80% planuotos (konfigūruojama)

-   Metinė biudžeto suvestinė pagal šaltinį ir kategoriją

**API endpoint\'ai:**

GET /api/budget/sources --- šaltinių sąrašas

POST /api/budget/sources --- naujas šaltinis (AM admin)

GET /api/budget/sources/:id/allocations --- eilutės pagal šaltinį

POST /api/budget/allocations --- nauja eilutė

GET /api/budget/summary --- suvestinė su likučiais

**4.2 project.service.ts --- projektų ir spec. programų valdymas**

Valdo 3 lygio objektus: projektus, spec. programas, skyriaus veiklas.

**Funkcijos:**

-   Projekto / programos / veiklos kūrimas ir susiejimas su
    budget_allocation

-   Spec. programos automatinis kūrimas iš patvirtinto prašymo (per
    request_id)

-   Veiklų planas: veiklos, terminai, atsakingi asmenys

-   Projekto biudžeto sekimas: planuota vs faktinė

-   Statusų valdymas: planuojama → vykdoma → baigta → uždaryta

**Spec. programos kūrimas iš prašymo --- logika:**

-   AM patvirtina prašymą ir nurodo approved_amount

-   Sistema automatiškai kuria project įrašą: tipas = spec_programa,
    biudžetas = approved_amount, request_id = prašymo ID

-   Institucija gauna pranešimą: \'Spec. programa sukurta, galite
    pradėti vykdymą\'

-   Jei automatinis kūrimas nepageidaujamas --- mygtukas AM patvirtinimo
    ekrane

**4.3 expense.service.ts --- išlaidų sekimas**

Faktinių išlaidų kaupimas ir susiejimas su biudžeto eilutėmis.

**Išlaidų tipai:**

-   DU išlaidos --- darbuotojas × mėnuo × suma × šaltinio dalis (iš
    payroll.service)

-   Sutarčių išlaidos --- iš contracts.service, susiejamos su projektu

-   Tiesioginės išlaidos --- rankiniu būdu įvestos arba iš sąskaitų

**Logika:**

-   Kiekviena išlaida turi: project_id, budget_allocation_id, suma,
    data, tipas, aprašymas

-   Išlaida automatiškai mažina biudžeto eilutės likutį

-   Viena išlaida gali būti padalinta tarp kelių šaltinių (pvz. DU 60%
    biudžetas + 40% ES)

**4.4 payroll.service.ts --- DU paskirstymas**

Supaprastintas DU valdymas finansinio planavimo tikslams. Nesikerta su
HR sistema.

-   Darbuotojo finansinis profilis: atlyginimas bruto, priedai,
    sutarties tipas

-   Paskirstymo taisyklės: kiek procentų arba kokia fiksuota suma iš
    kiekvieno šaltinio

-   Paskirstymas gali keistis kas mėnesį --- sistema saugo istoriją

-   Automatinis mėnesio DU kaštų skaičiavimas pagal šaltinį ir
    paskirstymą

-   Rezultatas paduodamas į expense.service kaip DU išlaidų įrašai

  -----------------------------------------------------------------------
  **Prieiga:** Atlyginimų duomenis mato tik AM administratorius ir
  atitinkamos institucijos vadovas (savo komandai). Specialistas savo
  duomenų nematosi.

  -----------------------------------------------------------------------

**4.5 report.service.ts --- ataskaitos**

Finansinių ataskaitų generavimas iš sukauptų duomenų.

-   Biudžeto vykdymo ataskaita: planuota vs faktinė vs likutis --- pagal
    šaltinį ir kategoriją

-   Spec. programos ataskaita: prašyta suma vs patvirtinta vs panaudota

-   DU paskirstymo ataskaita: kas kiek iš kurio šaltinio per laikotarpį

-   Eksportas į Excel (.xlsx) ir PDF

-   Ataskaitų šablonai: mėnesio suvestinė, metinė, projektinė

**5. Funkcinių reikalavimų sąrašas**

**5.1 Pakeitimai esamai sistemai**

  -------- --------------------------------------- ------------ -----------------
  **ID**   **Reikalavimas**                        **Tipas**    **Prioritetas**

  P01      Prašymo wizard\'as papildytas biudžeto  Pakeitimas   Privalomas
           kategorijos pasirinkimu                              

  P02      Spec. programos prašymui --- papildomas Pakeitimas   Privalomas
           finansavimo tipo klausimas                           

  P03      AM patvirtinimo ekranas rodo biudžeto   Pakeitimas   Privalomas
           kategoriją ir leidžia įvesti                         
           approved_amount                                      

  P04      Patvirtinus prašymą --- automatinis     Pakeitimas   Privalomas
           arba rankinis FVM projekto sukūrimas                 

  P05      Nauji DB laukai prašymo modelyje        Pakeitimas   Privalomas
           (migracija, atgalinis suderinamumas)                 

  P06      Dashboard papildytas prašymų statistika Papildymas   Pageidautinas
           pagal biudžeto kategoriją                            
  -------- --------------------------------------- ------------ -----------------

**5.2 Nauji FVM servisai**

  -------- --------------------------------------- ------------ -----------------
  **ID**   **Reikalavimas**                        **Tipas**    **Prioritetas**

  F01      Finansavimo šaltinių kūrimas ir         Naujas       Privalomas
           valdymas (AM administratorius)                       

  F02      Biudžeto eilučių skaidymas pagal        Naujas       Privalomas
           kategorijas (DU, spec. prog., P&P,                   
           kita)                                                

  F03      Spec. programos automatinis sukūrimas   Naujas       Privalomas
           iš patvirtinto prašymo                               

  F04      Spec. programos finansavimo tipo        Naujas       Privalomas
           valdymas (atskiras vs biudžeto dalis)                

  F05      Projekto / veiklos kūrimas ir           Naujas       Privalomas
           susiejimas su biudžeto eilute                        

  F06      Faktinių išlaidų kaupimas ir susiejimas Naujas       Privalomas
           su projektu ir biudžeto eilute                       

  F07      Išlaidos padalijimas tarp kelių         Naujas       Privalomas
           finansavimo šaltinių                                 

  F08      Automatinis biudžeto likučio            Naujas       Privalomas
           skaičiavimas realiu laiku                            

  F09      Darbuotojo finansinio profilio ir DU    Naujas       Privalomas
           paskirstymo valdymas                                 

  F10      Automatinis mėnesio DU kaštų            Naujas       Privalomas
           paskaičiavimas pagal šaltinį                         

  F11      Įspėjimai apie biudžeto limito artėjimą Naujas       Privalomas
           (konfigūruojama riba)                                

  F12      Biudžeto vykdymo ataskaita (planas vs   Naujas       Privalomas
           faktinis vs likutis)                                 

  F13      Spec. programos ataskaita (prašyta →    Naujas       Privalomas
           patvirtinta → panaudota)                             

  F14      Eksportas į Excel ir PDF                Naujas       Privalomas

  F15      Dashboard: biudžeto suvestinė,          Naujas       Privalomas
           artėjantys terminai, pavojaus signalai               

  F16      Biudžeto planavimas kitiem metams       Naujas       Pageidautinas
           (kopijavimas iš praėjusių)                           

  F17      Integracija su VBAMS mokėjimų statusams Naujas       2 fazė

  F18      Integracija su SABIS sąskaitų duomenims Naujas       2 fazė
  -------- --------------------------------------- ------------ -----------------

**6. Duomenų modelis --- naujos DB lentelės**

  -----------------------------------------------------------------------
  **Svarbu:** Visos naujos lentelės --- atskiros migracijos. Esamos
  lentelės (requests, users, tenants) tik papildomos naujais laukais per
  ALTER TABLE migraciją.

  -----------------------------------------------------------------------

**6.1 funding_sources**

id uuid PK

tenant_id uuid FK → tenants.id

pavadinimas varchar(200)

kodas varchar(50) \-- unikalus per tenant

tipas enum(biudzetas, ES, kita)

metai integer

metine_suma decimal(15,2)

aprasymas text

aktyvus boolean default true

created_at timestamptz

**6.2 budget_allocations**

id uuid PK

funding_source_id uuid FK → funding_sources.id

kategorija enum(DU, spec_programa, prekes_paslaugos, investicijos, kita)

pavadinimas varchar(200) \-- pvz. \'Spec. programa: Saugomų teritorijų
priežiūra\'

spec_prog_tipas enum(atskiras, biudzeto_dalis) NULL \-- tik spec.
programoms

planuota_suma decimal(15,2)

metai integer

pastabos text

**6.3 projects (bendras 3 lygio objektas)**

id uuid PK

tenant_id uuid FK → tenants.id

budget_allocation_id uuid FK → budget_allocations.id

request_id uuid FK → requests.id NULL \-- tik spec. programoms

pavadinimas varchar(300)

tipas enum(projektas, spec_programa, veikla)

biudzetas decimal(15,2) \-- patvirtinta suma arba planuojama

pradzios_data date

pabaigos_data date

statusas enum(planuojama, vykdoma, baigta, uzdaryta)

atsakingas_user_id uuid FK → users.id

aprasymas text

**6.4 expenses (faktinės išlaidos)**

id uuid PK

project_id uuid FK → projects.id

budget_allocation_id uuid FK → budget_allocations.id

tipas enum(DU, sutartis, saskaita, tiesiogine)

suma decimal(15,2)

data date

aprasymas varchar(500)

saltinio_dalis jsonb NULL \-- \[{funding_source_id, suma}\] kai dalijama

created_by uuid FK → users.id

**6.5 payroll_profiles (DU profiliai)**

id uuid PK

tenant_id uuid FK → tenants.id

user_id uuid FK → users.id

pareigos varchar(200)

sutarties_tipas enum(darbo, paslaugu, autorine)

atlyginimas decimal(10,2) \-- bruto

priedai decimal(10,2)

galioja_nuo date

galioja_iki date NULL

**6.6 payroll_distributions (DU paskirstymas)**

id uuid PK

payroll_profile_id uuid FK → payroll_profiles.id

funding_source_id uuid FK → funding_sources.id

paskirstymo_tipas enum(procentais, fiksuota)

reiksme decimal(10,4) \-- % arba suma

galioja_nuo date

galioja_iki date NULL

**7. Orientaciniai terminai**

  ------------------- ----------------------------------- ---------------
  **Etapas**          **Turinys**                         **Terminas**

  DB schema derinimas Lentelių struktūra, migracijos,     T+1 sav.
                      ryšiai                              

  Esamos sistemos     P01--P05: wizard, patvirtinimas, DB T+3 sav.
  pakeitimai          laukai                              

  budget.service +    Šaltiniai, paskirstymas, projektai  T+7 sav.
  project.service                                         

  expense.service +   Išlaidos, DU paskirstymas           T+10 sav.
  payroll.service                                         

  report.service +    Ataskaitos, suvestinė, eksportas    T+13 sav.
  dashboard                                               

  Testavimas ir       UAT, dokumentacija, diegimas prod   T+15 sav.
  pristatymas                                             

  2 fazė (VBAMS,      Integracijos                        Atskiras etapas
  SABIS)                                                  
  ------------------- ----------------------------------- ---------------

**8. Klausimai rangovui**

-   Kaip siūlote realizuoti automatinį spec. programos sukūrimą iš
    prašymo --- event\'ais ar tiesioginis servisų ryšys?

-   Ar jsonb laukas saltinio_dalis (išlaidų dalijimas) tinkamas
    sprendimas ar geriau atskira junction lentelė?

-   Kaip planuojate testuoti biudžeto likučio skaičiavimo teisingumą
    esant dideliam išlaidų kiekiui?

-   Ar payroll modulis turėtų skaičiuoti darbdavio mokesčius (Sodra ir
    kt.) ar tik bruto sumą?

*Versija 0.1. Dokumentas parengtas remiantis finansai.biip.lt
architektūros dokumentacija ir organizacijos finansų struktūros analize.
Skaičiai ir sumos iliustraciniai.*
