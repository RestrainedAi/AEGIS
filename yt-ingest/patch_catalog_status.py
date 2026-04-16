#!/usr/bin/env python3
"""
patch_catalog_status.py
Downloads latest_catalog_wide.csv from GCS, adds a 'status' column
for clips marked removed_from_suno in Firestore, uploads back.
"""
import csv, json, subprocess, sys, io, urllib.request, urllib.error

PROJECT  = "stable-framing-482501-t9"
DATABASE = "(default)"
BUCKET   = "aeonimus-workspaces"
OBJECT   = "exports/suno/latest_catalog_wide.csv"
GCS_PATH = f"gs://{BUCKET}/{OBJECT}"

def get_token():
    r = subprocess.run(["gcloud","auth","application-default","print-access-token"],
                       capture_output=Trucea,t  t>e x~t/=yTtr-uien)g
e s t / piaft crh._rceattuarlnocgo_dset a!t=u s0.:p
y   < <   ' P Y EpOrFi'n
t#(!"/EuRsRrO/Rb:i"n,/ ern.vs tpdyetrhro)n;3 
s"y"s".
epxaittc(h1_)c
a t a l orge_tsutrant urs..sptyd
oDuotw.nsltoraidps( )l
a
tdeesft _gceatt_arleomgo_vweidd_ek.ecyssv( tforkoemn )G:C
S ,   a d"d"s" Qau e'rsyt aFtiurse's tcoorleu mfno
rf oarl lc lsiupnso Smoanrgkse dd orcesm owvietdh_ fsrtoamt_ussu n=o=  i'nr eFmiorveesdt_ofrreo,m _uspulnooa'd.s" "b"a
c k . 
 "u"r"l
 i=m p(ofr"th tctspvs,: /j/sfoinr,e sstuobrper.ogcoeosgsl,e aspyiss,. cioom,/ vu1r/lplriobj.ercetqsu/e{sPtR,O JuErClTl}i"b
. e r r o r 
 
 P R O JfE"C/Td a t=a b"assteasb/l{eD-AfTrAaBmAiSnEg}-/4d8o2c5u0m1e-ntt9s":
rDuAnTQAuBeArSyE" )=
  " ( d ebfoaduyl t=) "{
"BsUtCrKuEcTt u r e=d Q"uaeeroyn"i:m u{s
- w o r k s p a c"efsr"o
mO"B:J E[C{T" c o l=l e"cetxipoonrItds"/:s u"nsou/nloaStoensgts_"c}a]t,a
l o g _ w i d e ."cwshve"r
eG"C:S _{P"AfTiHe l=d Ffi"lgtse:r/"/:{ B{U
C K E T } / { O B J E C T"}f"i
e
ldde"f:  g{e"tf_iteolkdePna(t)h:"
:   " s tra t=u ss"u}b,p
r o c e s s . r u n ( [ ""gocpl"o:u d""E,Q"UaAuLt"h,"
, " a p p l i c a t i o n"-vdaelfuaeu"l:t "{,""sptrriinntg-Vaaclcuees"s:- t"orkeemno"v]e,d
_ f r o m _ s u n o " } 
                 } } ,c
a p t u r e _ o u"tspeulte=cTtr"u:e ,{ "tfeixetl=dTsr"u:e )[
{ " f i eilfd Pra.trhe"t:u r"nscoondgeK e!y=" }0]:}

         } } 
  p r i ndta(t"aE R=R OjRs:o"n,. dru.msptsd(ebrord)y;) .seynsc.oedxei(t)(
1 ) 
    r e qr e=t uurrnl lri.bs.trdeoquute.sstt.rRiepq(u)e
s
td(eufr lg,e td_arteam=odvaetda_,k emyest(htoodk=e"nP)O:S
T " , 
  " " " Q u e r y   Fhieraedsetrosr=e{ "fAourt haolrli zsautniooSno"n:g sf "dBoecasr ewri t{ht oskteant}u"s, 
= =   ' r e m o v e d _ f r o m _ s u n"oC'o.n"t"e"n
t - T y puer"l:  =" a(pfp"lhitctaptsi:o/n//fjisroens"t}o)r
e . g o owgilteha puirsl.lciobm./rve1q/upersotj.eucrtlso/p{ePnR(OrJeEqC)T }a"s
  r e s p : 
          f " / draetsaublatsse s=/ {jDsAoTnA.BlAoSaEd}s/(droecsupm.ernetasd:(r)u)n
Q u e r yk"e)y
s   =   sbeotd(y) 
=   { " sftorru cdtoucr eidnQ ureersyu"l:t s{:

                "ffireolmd"s:  =[ {d"occo.lgleetc(t"idooncIudm"e:n t""s,u n{o}S)o.nggest"(}"]f,i
e l d s " ,   { }")w
h e r e " :   { "sfki e=l dfFiielltdesr."g:e t{(
" s o n g K e y " ,   { }")f.igeeltd("":s t{r"ifnigeVladlPuaet"h," :" "")s
t a t u s " } , 
i f   s k : 
            " o p " :   "kEeQyUsA.La"d,d
( s k ) 
         p r i n"tv(afl"u e "F:o u{n"ds t{rlienng(Vkaelyuse)"}:  r"ermeomvoevde_df_rformo_ms_usnuon os"o}n
g K e y s   i n  }F}i,r
e s t o r e " ) 
" s e l ercett"u:r n{ "kfeiyesl
d
sd"e:f  [m{a"ifni(e)l:d
P a t h "p:r i"nsto(n"g[K1e/y4"]} ]G}e
t t i n g} }a
u t h   tdoaktean .=. .j"s)o
n . d u mtposk(ebno d=y )g.eetn_ctoodkee(n)(
) 
 
    r e qp r=i nutr(l"l[i2b/.4r]e qFueetscth.iRnegq ureesmto(vuerdl ,s odnagtKae=ydsa tfar,o mm eFtihroeds=t"oPrOeS.T.".,"
) 
         r e m o vheeda d=e rgse=t{_"rAeumtohvoerdi_zkaetyiso(nt"o:k efn")B
e
a r e r  p{rtionkte(nf}""[,3
/ 4 ]   D o w n l o a d i n g   { G C S"_CPoAnTtHe}n.t.-.T"y)p
e " :   "ra p=p lsiucbaptrioocne/sjss.ornu"n}()[
" g s u twiilt"h, "ucrpl"l,i bG.CrSe_qPuAeTsHt,. u"r/ltomppe/nc(arteaql)o ga_so rriegs.pc:s
v " ] , 
        r e s u l t s   =   j s o n . l o a d sc(arpetsupr.er_eoaudt(p)u)t
= T r u ek,e ytse x=t =sTertu(e))

        fiofr  rd.orce tiunr nrceosduel t!s=: 
0 : 
            f i eplrdisn t=( "dgoscu.tgielt (E"RdRoOcRu:m"e,n tr".,s t{d}e)r.rg)e;t (s"yfsi.eelxdist"(,1 ){
}
) 
      w i t h   ospke n=( "f/itemlpd/sc.agteatl(o"gs_oonrgiKge.yc"s,v "{,} )n.egwelti(n"es=t"r"i,n geVnacloudei"n,g ="""u)t
f - 8 " )   a s  iff: 
s k : 
          r e a d e r   =k ecyssv..aDdidc(tsRke)a
d e r ( fp)r
i n t ( f "     Froouwnsd  ={ lleins(tk(eryesa)d}e rr)e
m o v e d _ f r oomr_isgu_nfoi eslodnsg K=e yrse aidne rF.ifrieesltdonraem"e)s
  o r   [r]e
t
u r n   kperyisn
t
(dfe"f   mLaoiand(e)d: 
{ l e n (prroiwnst)(}" [r1o/w4s],  G{eltetni(nogr iagu_tfhi etlodkse)n}. .c.o"l)u
m n s " )t
o
k e n   =#  gAedtd_ t'oskteant(u)s
'
  c o l upmrni nitf( "n[o2t/ 4p]r eFseetncth
i n g   riefm o"vsetda tsuosn"g Kneoyts  ifnr oomr iFgi_rfeisetlodrse:.
. . " ) 
        oruetm_ofvieedl d=s  g=e tl_irsetm(oovreidg__kfeiyesl(dtso)k e+n )[
"
s t a t upsr"i]n
t ( f " [e3l/s4e]: 
D o w n l o a d ionugt _{fGiCeSl_dPsA T=H }l.i.s.t"()o
r i g _ fri e=l dssu)b
p r o c e s s . rpurni(n[t"(g"s u t'islt"a,t"ucsp'" ,c oGlCuSm_nP AaTlHr,e a"d/yt mepx/icsattsa lo gw_iolrli go.vcesrvw"r]i,t
e " ) 
 
         u p d a t e d   =   0 
      c afpotru rreo_wo uitnp urto=wTsr:u
e ,   t e x t = Tsrku e=) 
r o w . gieft (r".sroentguKrenyc"o,d e" "!)=
  0 : 
          i f   spkr iinnt (r"egmsouvteidl: 
E R R O R : " ,   r . s trdoewr[r")s;t astyuss."e]x i=t ("1r)e
m
o v e d _wfirtohm _ospuenno(""
/ t m p / c a t a l o g _uoprdiagt.ecds v+"=,  1n
e w l i n e = " "e,l iefn c"osdtiantgu=s""u tnfo-t8 "i)n  arso wf :o
r   n o t   r o wr.egaedte(r" s=t actsuvs."D)i:c
t R e a d e r ( f ) 
    r o w [ " s traotwuss "=]  l=i s"t"(
r
e a d e rp)r
i n t ( f "     Moarrikge_df i{eulpddsa t=e dr}e ardoewrs. faise lrdenmaomveesd _ofrr o[m]_
s
u n o " )p
r
i n t ( fw"i t hL ooapdeend( "{/ltemnp(/rcoawtsa)l}o gr_ouwpsd,a t{elde.nc(sovr"i,g _"fwi"e,l dnse)w}l icnoel=u"m"n,s "e)n
c
o d i n g#= "Audtdf -'8s"t)a tauss 'f :c
o l u m n   i f  wnroitt eprr e=s ecnstv
. D i c tiWfr i"tsetra(tfu,s "f ineoltd nianm eosr=iogu_tf_ifeiledlsd:s
,   e x t r a s aocutti_ofni=e"lidgsn o=r el"i)s
t ( o r i g _ f iwerlidtse)r .+w r[i"tsethaetaudse"r](
) 
      e l s e : 
w r i t e r . w roiutte_rfoiwesl(drso w=s )l
i
s t ( o rpirgi_nfti(efl"d[s4)/
4 ]   U p l o a dpirnign tb(a"c k  'tsot a{tGuCsS'_ PcAoTlHu}m.n. .a"l)r
e a d y  re x=i sstusb pr owcielsls .orvuenr(w[r"igtseu"t)i
l
" , " c pu"p,d"a/ttemdp /=c a0t
a l o g _fuoprd artoewd .icns vr"o,w sG:C
S _ P A T H ] , 
s k   =   r o w . g e t ( " s o n g K e y " ,  c"a"p)t
u r e _ o u t p uitf= Tsrku ei,n  treexmto=vTerdu:e
) 
         i f   r . r ertouwr[n"csotdaet u!s=" ]0 :=
  " r e m o v e dp_rfirnotm(_"sgusnuot"i
l   U P L O A D   E R R OuRp:d"a,t erd. s+t=d e1r
r ) ;   s y s . eexliitf( 1")s
t
a t u s "p rniontt (ifn" \rnow  Doorn en o tc artoawl.ogge tu(p"dsattaetdu sw"i)t:h
  s t a t u s   c o l u mrno w([{"usptdaattuesd"}]  r=e m"o"v
e
d   c l ipprsi nmta(rfk"e d )M"a)r
k
eidf  {_u_pndaamtee_d_}  =r=o w"s_ _amsa irne_m_o"v:e
d _ f r omma_isnu(n)o
"P)Y
E
O F   with open("/tmp/catalog_updated.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=out_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    print(f"[4/4] Uploading back to {GCS_PATH}...")
    r = subprocess.run(["gsutil","cp","/tmp/catalog_updated.csv", GCS_PATH],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("gsutil UPLOAD ERROR:", r.stderr); sys.exit(1)

    print(f"\n Done  catalog updated with status column ({updated} removed clips marked)")

if __name__ == "__main__":
    main()
