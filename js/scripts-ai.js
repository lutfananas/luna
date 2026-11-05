/*
 * Luna AI Signal 1H: indikator & strategy buatan Luna berbasis machine learning.
 *
 * Model: 80 pohon keputusan (gradient boosting, kedalaman 2), dilatih di 16 koin Binance 1H
 * (Nov 2023 – Okt 2025) untuk memperkirakan hasil (R, setelah komisi 0,1%) dari trade bracket:
 * SL 3×ATR, TP1 1R (50%, lalu SL ke BE), TP2 2R, time exit 72 jam.
 * Fitur (semua dari candle yang sudah close, tanpa repaint): tren EMA 50/200/480 & kemiringannya,
 * RSI 14 & RSI "4H" (56), momentum 24 jam & 1 minggu, volatilitas (ATR%, rezim ATR, lebar Bollinger),
 * volume relatif, posisi dalam range 24 jam & 20 hari, SIKLUS (hari sejak low 30 hari, kenaikan dari low,
 * kapan puncak setelah low terjadi), posisi terhadap high/low harian & mingguan kemarin, bentuk candle,
 * jam UTC dan hari dalam seminggu. Fitur dicerminkan untuk short, jadi model belajar pola, bukan bias arah.
 * Uji jujur (tes Nov 2025 – Nov 2026, tidak dipakai saat membangun model): lihat README.
 */
(function (root) {
  'use strict';

  // eslint-disable-next-line
  const MODEL = {"f0":-0.053895112712735456,"th5":0.0816175409208612,"th1":0.15001481197504002,"trees":[{"j":19,"th":0.5,"kids":[{"j":28,"th":2,"l":0.001222471474907597,"r":-0.008156888017849473},{"j":28,"th":2,"l":-0.0033085401877345506,"r":0.009723305904744965}]},{"j":19,"th":0.5,"kids":[{"j":28,"th":2,"l":0.001100224327416822,"r":-0.007341199216064568},{"j":28,"th":2,"l":-0.002977686168961114,"r":0.00875097531427031}]},{"j":19,"th":0.5,"kids":[{"j":28,"th":2,"l":0.0009902018946751719,"r":-0.006607079294458188},{"j":28,"th":2,"l":-0.0026799175520649883,"r":0.007875877782843205}]},{"j":14,"th":0.499999999999999,"kids":[{"j":10,"th":1.7610187880058286,"l":-0.0050848149244564385,"r":0.002961872582430976},{"j":28,"th":2,"l":-0.0015645396727376221,"r":0.006523623989764191}]},{"j":19,"th":0.4197952218430028,"kids":[{"j":28,"th":2,"l":0.0016094783364589073,"r":-0.006826014421538965},{"j":28,"th":2,"l":-0.002196748307451482,"r":0.005962725790768703}]},{"j":14,"th":0.499999999999999,"kids":[{"j":10,"th":1.7610187880058286,"l":-0.004388380552031991,"r":0.0028706458894798568},{"j":28,"th":2,"l":-0.00122581686548632,"r":0.00540016051802001}]},{"j":19,"th":0.5,"kids":[{"j":16,"th":15.125,"l":0.0014068044891249422,"r":-0.0053049068751925945},{"j":28,"th":2,"l":-0.001882297751430395,"r":0.00554681118226467}]},{"j":19,"th":0.4197952218430028,"kids":[{"j":28,"th":2,"l":0.0019332410946199274,"r":-0.005738293748720804},{"j":16,"th":15.125,"l":-0.0016637859280717424,"r":0.0046767364692104}]},{"j":14,"th":0.499999999999999,"kids":[{"j":10,"th":1.4876855060740741,"l":-0.004218746871891453,"r":0.001710354555620789},{"j":28,"th":2,"l":-0.0010941944246217186,"r":0.004299232837412537}]},{"j":0,"th":3.155673927637511,"kids":[{"j":10,"th":0.7202063317957338,"l":-0.005784910091557557,"r":0.0002739453382775031},{"j":28,"th":2,"l":-0.004269117443336935,"r":0.016084476990389302}]},{"j":21,"th":4.994927643626495,"kids":[{"j":2,"th":3.696797184895157,"l":0.0023327864431330896,"r":-0.001707604954002397},{"j":28,"th":2,"l":0.004033398052513675,"r":-0.009009920917998153}]},{"j":0,"th":3.155673927637511,"kids":[{"j":2,"th":7.886094156967143,"l":0.00018225230305926618,"r":-0.005831246584624984},{"j":28,"th":2,"l":-0.0037845302516250606,"r":0.014558757843631732}]},{"j":10,"th":0.7202063317957338,"kids":[{"j":7,"th":0.49056729320019743,"l":-0.010135718249907924,"r":-0.0005906825878152613},{"j":21,"th":5.782410746471849,"l":0.0013085154607285754,"r":-0.003803101211459369}]},{"j":0,"th":-3.1540723371829444,"kids":[{"j":16,"th":12.708333333333334,"l":0.005668228902814277,"r":-0.013263619666241325},{"j":2,"th":-3.701459382724124,"l":0.003333732034319083,"r":-0.0007393398119490048}]},{"j":19,"th":0.5771704180064312,"kids":[{"j":9,"th":-19.088836865450954,"l":0.0075453734358254315,"r":-0.002275900151798505},{"j":10,"th":2.6490168562427137,"l":0.002794686613875284,"r":-0.01276513890590152}]},{"j":10,"th":0.5797197046834253,"kids":[{"j":9,"th":0,"l":-0.011797034201428231,"r":-0.00044913116528462525},{"j":2,"th":3.696797184895157,"l":0.0014381678649889999,"r":-0.0018341281058061477}]},{"j":0,"th":3.155673927637511,"kids":[{"j":8,"th":7.022521723709874,"l":-9.759556152891106e-05,"r":-0.009413973700367471},{"j":16,"th":12.708333333333334,"l":-0.004856951858743427,"r":0.012517448701053757}]},{"j":0,"th":-3.1540723371829444,"kids":[{"j":28,"th":2,"l":0.004156814996486606,"r":-0.012852157506396886},{"j":8,"th":-7.00558475689882,"l":0.009850919628463402,"r":5.495540413362416e-05}]},{"j":14,"th":0.499999999999999,"kids":[{"j":10,"th":1.7610187880058286,"l":-0.002844594564728636,"r":0.002707052049109867},{"j":10,"th":2.2076366393666826,"l":0.0023786644479844264,"r":-0.004995023968692077}]},{"j":10,"th":0.7202063317957338,"kids":[{"j":7,"th":0.49056729320019743,"l":-0.00842061760684708,"r":-0.0005157163955920494},{"j":21,"th":5.782410746471849,"l":0.0010649502032688812,"r":-0.002992531102450258}]},{"j":2,"th":-7.852081291587583,"kids":[{"j":9,"th":-4.978962131837306,"l":0.0007785459534277013,"r":0.020895931879523426},{"j":4,"th":-0.001085459792547052,"l":-0.0024773518957955333,"r":0.001021507381682717}]},{"j":2,"th":7.886094156967143,"kids":[{"j":21,"th":-1.5509788544086018,"l":0.008071465761743129,"r":0.00013457677072329388},{"j":9,"th":4.982817869415812,"l":-0.021097715812177467,"r":-0.000655196861485238}]},{"j":9,"th":-13.286109461444696,"kids":[{"j":28,"th":3,"l":0.010547008490472704,"r":-0.00668445093524735},{"j":7,"th":0.4313237362016893,"l":-0.007696570230248362,"r":8.66579899986244e-05}]},{"j":10,"th":0.5797197046834253,"kids":[{"j":9,"th":0,"l":-0.009964069738341408,"r":-0.00015328430860366175},{"j":2,"th":3.696797184895157,"l":0.0013128460702321897,"r":-0.0017866657438216811}]},{"j":0,"th":3.155673927637511,"kids":[{"j":2,"th":9.947058668146132,"l":2.227771770852332e-05,"r":-0.00696983358182322},{"j":28,"th":2,"l":-0.004382533794269755,"r":0.011880549192696745}]},{"j":2,"th":-7.852081291587583,"kids":[{"j":9,"th":-4.978962131837306,"l":0.0005097553426917607,"r":0.018909850517062846},{"j":21,"th":4.994927643626495,"l":0.00023751640974973166,"r":-0.004082538398539423}]},{"j":10,"th":0.8272110402784009,"kids":[{"j":4,"th":-0.001085459792547052,"l":-0.006975310768425454,"r":0.0019127546493704576},{"j":9,"th":19.224620303757,"l":0.0009663769505861624,"r":-0.00409286675989278}]},{"j":0,"th":3.155673927637511,"kids":[{"j":8,"th":7.022521723709874,"l":-1.7880518931796224e-05,"r":-0.008594010550864494},{"j":16,"th":12.708333333333334,"l":-0.0051415692104568944,"r":0.0101989693829039}]},{"j":9,"th":-13.286109461444696,"kids":[{"j":28,"th":3,"l":0.009324720362815439,"r":-0.006186149871645601},{"j":7,"th":0.44755616304015244,"l":-0.005314341194901952,"r":0.00027910501511578534}]},{"j":2,"th":7.886094156967143,"kids":[{"j":21,"th":-1.5509788544086018,"l":0.0067271354525347375,"r":9.722096239730397e-05},{"j":17,"th":7.399640503295379,"l":0.010089471176108748,"r":-0.006753183545110295}]},{"j":10,"th":0.5797197046834253,"kids":[{"j":9,"th":0,"l":-0.008599634755020088,"r":-4.3647682515059176e-05},{"j":2,"th":-3.701459382724124,"l":0.0021826374326980465,"r":-0.0005814063431068276}]},{"j":0,"th":-3.1540723371829444,"kids":[{"j":16,"th":12.708333333333334,"l":0.0061010096065097,"r":-0.010185330672237177},{"j":8,"th":-7.00558475689882,"l":0.008882021851655588,"r":-1.8040675892233258e-05}]},{"j":14,"th":0.499999999999999,"kids":[{"j":16,"th":15.125,"l":0.0013238813921647903,"r":-0.002931350252070268},{"j":16,"th":15.125,"l":-0.0015826323996973313,"r":0.0031306460493495795}]},{"j":2,"th":-9.948836130191559,"kids":[{"j":9,"th":-4.978962131837306,"l":0.000158512010619348,"r":0.034796263557750215},{"j":17,"th":4.889090086011771,"l":0.005019090650869147,"r":-0.0005878792293367656}]},{"j":2,"th":3.696797184895157,"kids":[{"j":20,"th":0.831134564643799,"l":0.001431547750301825,"r":-0.008206213752058813},{"j":28,"th":3,"l":-0.0056145211564010275,"r":0.0037028469739812486}]},{"j":4,"th":-0.001085459792547052,"kids":[{"j":28,"th":3,"l":0.0037065685356141194,"r":-0.007444094177862386},{"j":28,"th":3,"l":-0.00360962602755155,"r":0.007314934633689315}]},{"j":10,"th":0.7202063317957338,"kids":[{"j":2,"th":-0.009192804103893275,"l":0.0013796560602214617,"r":-0.0068480448853368465},{"j":9,"th":13.292814429957843,"l":0.0008395999681909128,"r":-0.0023190412826373124}]},{"j":7,"th":0.47124253387068116,"kids":[{"j":28,"th":3,"l":0.004442806967520738,"r":-0.009333129079664017},{"j":16,"th":12.708333333333334,"l":-0.003257416311060876,"r":0.0031099176886040534}]},{"j":15,"th":0.8392434988179669,"kids":[{"j":2,"th":9.947058668146132,"l":-5.40491515202692e-05,"r":-0.013324478931886225},{"j":28,"th":3,"l":-0.004874585469465769,"r":0.012038080247994895}]},{"j":8,"th":-7.00558475689882,"kids":[{"j":28,"th":2,"l":0.01433611234803914,"r":-0.003526260470787699},{"j":10,"th":2.6490168562427137,"l":5.6520289158437436e-05,"r":-0.006424614412656265}]},{"j":19,"th":1.359447004608296,"kids":[{"j":8,"th":3.429027113237637,"l":0.00026410780723801355,"r":-0.003283900259652476},{"j":16,"th":12.708333333333334,"l":-0.007033429533925363,"r":0.010140609670780235}]},{"j":10,"th":0.8272110402784009,"kids":[{"j":4,"th":-0.001085459792547052,"l":-0.005939920722088473,"r":0.0017595146611115399},{"j":8,"th":0,"l":0.0015687472850184317,"r":-0.0006135040932131191}]},{"j":7,"th":0.47124253387068116,"kids":[{"j":28,"th":3,"l":0.0038342122819423363,"r":-0.008363840988889973},{"j":28,"th":3,"l":-0.0018339310005496255,"r":0.004040627996151235}]},{"j":2,"th":-3.701459382724124,"kids":[{"j":18,"th":7.5,"l":0.005516206364429133,"r":-0.001973031650937781},{"j":20,"th":0.16852737905369486,"l":0.007654561465453598,"r":-0.001361947573758364}]},{"j":9,"th":1.518987341772149,"kids":[{"j":28,"th":3,"l":0.0024401948057168913,"r":-0.005283707238073652},{"j":28,"th":3,"l":-0.003291530988458872,"r":0.007104960438142534}]},{"j":2,"th":-3.701459382724124,"kids":[{"j":9,"th":-7.20835455934793,"l":-0.0013191529602212945,"r":0.005839620536246107},{"j":20,"th":0.06288532675708994,"l":0.010205837943904795,"r":-0.0011068805910969916}]},{"j":9,"th":1.518987341772149,"kids":[{"j":28,"th":3,"l":0.0021407179309038795,"r":-0.004822123650520853},{"j":28,"th":3,"l":-0.0028866452386350225,"r":0.006474559241089946}]},{"j":9,"th":-13.286109461444696,"kids":[{"j":17,"th":24.59060888446576,"l":0.012348402058237245,"r":-0.0026251079896092763},{"j":7,"th":0.44755616304015244,"l":-0.004595042825770518,"r":0.00024699315764462455}]},{"j":2,"th":3.696797184895157,"kids":[{"j":20,"th":0.831134564643799,"l":0.0013048277257946296,"r":-0.007379126855667633},{"j":9,"th":4.982817869415812,"l":-0.008009944856392615,"r":0.0011775083481097418}]},{"j":7,"th":0.47124253387068116,"kids":[{"j":16,"th":12.708333333333334,"l":0.005960488438365458,"r":-0.00578448865206215},{"j":16,"th":12.708333333333334,"l":-0.002845262293781484,"r":0.002752123106002622}]},{"j":8,"th":-7.00558475689882,"kids":[{"j":28,"th":2,"l":0.011906267127479431,"r":-0.0023770476750021165},{"j":10,"th":2.6490168562427137,"l":4.6017318658617224e-05,"r":-0.0057599865660368345}]},{"j":0,"th":-3.1540723371829444,"kids":[{"j":10,"th":2.2076366393666826,"l":-0.0066095630438577765,"r":0.011227810429525177},{"j":8,"th":-3.4412896466242127,"l":0.003573177252113682,"r":-0.0003133136672995426}]},{"j":14,"th":0.499999999999999,"kids":[{"j":11,"th":1.1820225067484682,"l":-0.0021436012701993657,"r":0.002688937367130169},{"j":11,"th":1.1820225067484682,"l":0.002258158937205471,"r":-0.0030429665097460186}]},{"j":0,"th":3.155673927637511,"kids":[{"j":8,"th":7.022521723709874,"l":9.903425743180717e-06,"r":-0.007350253030260677},{"j":10,"th":2.6490168562427137,"l":0.00552525105173135,"r":-0.015709714945211894}]},{"j":2,"th":3.696797184895157,"kids":[{"j":20,"th":0.831134564643799,"l":0.0012044962987590834,"r":-0.006728511625830109},{"j":9,"th":4.982817869415812,"l":-0.0072984424529434905,"r":0.001029878022786778}]},{"j":7,"th":0.47124253387068116,"kids":[{"j":16,"th":12.708333333333334,"l":0.005251582957570169,"r":-0.0053036633630349815},{"j":16,"th":12.708333333333334,"l":-0.0025084866387435935,"r":0.0025205201512770677}]},{"j":2,"th":7.886094156967143,"kids":[{"j":28,"th":0,"l":-0.003104887715817529,"r":0.0008627328844565961},{"j":17,"th":7.399640503295379,"l":0.009934376223480514,"r":-0.0058970724133968165}]},{"j":9,"th":1.518987341772149,"kids":[{"j":28,"th":3,"l":0.0018676608067969948,"r":-0.00430346889495706},{"j":28,"th":3,"l":-0.0025562133833745434,"r":0.005824593135561128}]},{"j":2,"th":-3.701459382724124,"kids":[{"j":20,"th":0.6579358874120408,"l":0.0019664018773076614,"r":-0.01779719114139961},{"j":20,"th":0.16852737905369486,"l":0.006629555100261975,"r":-0.0011974360111643987}]},{"j":9,"th":1.518987341772149,"kids":[{"j":10,"th":1.3765116321519202,"l":-0.0031958511098046927,"r":0.0025507742832457207},{"j":16,"th":12.708333333333334,"l":-0.0038194636131950854,"r":0.0040280672786299305}]},{"j":7,"th":0.47124253387068116,"kids":[{"j":16,"th":12.708333333333334,"l":0.004654771353891773,"r":-0.004861862983248871},{"j":28,"th":3,"l":-0.0012463450592092098,"r":0.003078510355258533}]},{"j":2,"th":-3.701459382724124,"kids":[{"j":9,"th":-7.20835455934793,"l":-0.0013744303613988991,"r":0.005595745999710263},{"j":9,"th":-13.286109461444696,"l":0.012649469258333868,"r":-0.0008925020435485231}]},{"j":19,"th":1.359447004608296,"kids":[{"j":8,"th":3.429027113237637,"l":0.00027575205240320085,"r":-0.003130637081455468},{"j":16,"th":12.708333333333334,"l":-0.0055840435188995695,"r":0.008525757399372379}]},{"j":7,"th":0.47124253387068116,"kids":[{"j":28,"th":3,"l":0.002652065726175922,"r":-0.006298351645169853},{"j":16,"th":12.708333333333334,"l":-0.0019437384649603697,"r":0.0020869074153926108}]},{"j":2,"th":-7.852081291587583,"kids":[{"j":28,"th":0,"l":-0.008005657423010085,"r":0.005050206377168826},{"j":17,"th":4.889090086011771,"l":0.005869581131940639,"r":-0.000664998458820335}]},{"j":8,"th":-0.5262186115214229,"kids":[{"j":10,"th":2.2076366393666826,"l":-0.00031199496455759103,"r":0.009024783099643356},{"j":10,"th":2.2076366393666826,"l":0.00026590780142929816,"r":-0.008499908251696529}]},{"j":19,"th":0.5771704180064312,"kids":[{"j":16,"th":15.125,"l":0.0015434728735308151,"r":-0.0025553562403944604},{"j":11,"th":1.1820225067484682,"l":0.002493763396023068,"r":-0.003550010135164913}]},{"j":10,"th":0.5797197046834253,"kids":[{"j":15,"th":0.3292106220443798,"l":-0.009897837219185189,"r":-0.0007016988429364667},{"j":2,"th":3.696797184895157,"l":0.0008904551221754587,"r":-0.0012270706661607882}]},{"j":9,"th":1.518987341772149,"kids":[{"j":28,"th":0,"l":-0.007448718010531825,"r":0.000342525153438402},{"j":28,"th":3,"l":-0.002081771707033651,"r":0.005102438425522951}]},{"j":25,"th":0.1342281879194602,"kids":[{"j":22,"th":-1.5342997255118684,"l":-0.004353043426939348,"r":0.001577703336364307},{"j":21,"th":-1.5509788544086018,"l":0.0034961408363537875,"r":-0.0007989499365721808}]},{"j":8,"th":-0.5262186115214229,"kids":[{"j":10,"th":1.9498427678093448,"l":-0.00051659296384296,"r":0.006757822168816096},{"j":10,"th":2.2076366393666826,"l":0.00014544348265156169,"r":-0.007565719331854815}]},{"j":15,"th":0.8392434988179669,"kids":[{"j":2,"th":9.947058668146132,"l":-5.0328802812786094e-05,"r":-0.010876857116922399},{"j":17,"th":45.38678485092667,"l":0.005497963970946842,"r":-0.0070801397098693266}]},{"j":0,"th":-3.1540723371829444,"kids":[{"j":10,"th":2.6490168562427137,"l":-0.00488565564805981,"r":0.013403848142695697},{"j":15,"th":0.27484874675885906,"l":0.0024094288079803457,"r":-0.0004251050925886948}]},{"j":7,"th":0.47124253387068116,"kids":[{"j":28,"th":3,"l":0.002460785364773826,"r":-0.005973825700182376},{"j":16,"th":12.708333333333334,"l":-0.0018605015019011611,"r":0.0020120190673823955}]},{"j":8,"th":-0.5262186115214229,"kids":[{"j":16,"th":15.125,"l":0.004229436487169356,"r":-0.0016142261266101979},{"j":11,"th":0.9160673906482889,"l":0.0015342486084174458,"r":-0.0031694925688553807}]},{"j":7,"th":0.5288524290940226,"kids":[{"j":28,"th":3,"l":0.0013752416705205448,"r":-0.003152590137691673},{"j":28,"th":3,"l":-0.003018351545320926,"r":0.0067268187963106345}]},{"j":2,"th":-3.701459382724124,"kids":[{"j":20,"th":0.6579358874120408,"l":0.0017918388764774033,"r":-0.016498108543488547},{"j":20,"th":0.06288532675708994,"l":0.008759238541438548,"r":-0.0009394143234274021}]},{"j":9,"th":1.518987341772149,"kids":[{"j":28,"th":0,"l":-0.0071673346361807964,"r":0.00032362777693265677},{"j":16,"th":12.708333333333334,"l":-0.0031703468182773665,"r":0.003480590862288984}]},{"j":24,"th":0.1666666666666619,"kids":[{"j":26,"th":0.49999999999999994,"l":7.27005932789375e-05,"r":-0.00367043789127944},{"j":21,"th":4.994927643626495,"l":0.0011009714722019057,"r":-0.0015828412741417598}]},{"j":2,"th":-3.701459382724124,"kids":[{"j":9,"th":-7.20835455934793,"l":-0.0013182399967663397,"r":0.005190542496900584},{"j":18,"th":0.25,"l":0.007548852590837704,"r":-0.0009642953917423946}]}]};

  const num = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  function treeCode(m) {
    const g = (j) => `array.get(x, ${j})`;
    const kid = (k) => ('leaf' in k ? num(k.leaf) : `(${g(k.j)} <= ${num(k.th)} ? ${num(k.l)} : ${num(k.r)})`);
    return m.trees.map((t) => `    s := s + (${g(t.j)} <= ${num(t.th)} ? ${kid(t.kids[0])} : ${kid(t.kids[1])})`).join('\n');
  }

  const COMMON = (m, levelDef) => String.raw`
gS = "Sinyal AI"
gP = "Tampilan"
iLevel = input.string("${levelDef}", "Tingkat seleksi", options = ["Normal (±5% skor teratas)", "Ketat (±1% skor teratas)"], group = gS, tooltip = "Normal: sekitar 0,2 trade/hari per koin (±3–4 trade/hari bila dipindai di 16 koin). Ketat: lebih jarang tetapi rata-rata R lebih tinggi.")
iSide  = input.string("Long & Short", "Arah", options = ["Long & Short", "Long saja", "Short saja"], group = gS)
showPlan = input.bool(true, "Gambar zona & level", group = gP)
showTbl  = input.bool(true, "Tampilkan panel AI", group = gP)
colL = input.color(#26a69a, "Long", group = gP)
colS = input.color(#ef5350, "Short", group = gP)

thr   = iLevel == "Ketat (±1% skor teratas)" ? ${m.th1} : ${m.th5}
sideI = iSide == "Long saja" ? 1 : iSide == "Short saja" ? -1 : 0
SLK = 3.0
MAXB = 72
WARM = 800

// ═════════════ FITUR ═════════════
atrV  = ta.atr(14)
atrL  = ta.sma(nz(atrV), 720)
e50   = ta.ema(close, 50)
e200  = ta.ema(close, 200)
e480  = ta.ema(close, 480)
e50x  = e50[24]
e200x = e200[24]
rsi14 = ta.rsi(close, 14)
rsi56 = ta.rsi(close, 56)
c24   = close[24]
c168  = close[168]
s20   = ta.sma(close, 20)
q20   = ta.sma(close * close, 20)
vma   = ta.sma(nz(volume), 168)
h24   = ta.highest(high, 24)
l24   = ta.lowest(low, 24)
h480  = ta.highest(high, 480)
l480  = ta.lowest(low, 480)
lo720 = ta.lowest(low, 720)
[pdh, pdl, pdc] = request.security(syminfo.tickerid, "D", [high[1], low[1], close[1]], lookahead = barmerge.lookahead_on)
[pwh, pwl, pwc] = request.security(syminfo.tickerid, "W", [high[1], low[1], close[1]], lookahead = barmerge.lookahead_on)

// siklus: candle low terendah 30 hari (terbaru bila sama) dan puncak sesudahnya
var int   lowIdx = na
var float hiC = na
var int   hiIdx = na
if not na(lo720)
    if low == lo720
        lowIdx := bar_index
        hiC := high
        hiIdx := bar_index
    else if na(lowIdx) or lowIdx < bar_index - 719
        for k = 0 to 719
            if low[k] == lo720
                lowIdx := bar_index - k
                break
        hiC := -1e18
        for k = bar_index - lowIdx to 0
            if high[k] > hiC
                hiC := high[k]
                hiIdx := bar_index - k
    else if high > hiC
        hiC := high
        hiIdx := bar_index

clampF(v, lo, hi) =>
    na(v) ? 0.0 : math.max(lo, math.min(hi, v))

f_feat() =>
    a = atrV
    c = close
    rng = math.max(high - low, 1e-12)
    sd = math.sqrt(math.max(q20 - s20 * s20, 0))
    hr = math.floor((time % 86400000) / 3600000)
    x = array.new_float(0)
    array.push(x, clampF((c - e50) / a, -15, 15))
    array.push(x, clampF((c - e200) / a, -30, 30))
    array.push(x, clampF((c - e480) / a, -40, 40))
    array.push(x, 0.0)
    array.push(x, clampF((e50 - e50x) / a, -10, 10))
    array.push(x, clampF((e200 - e200x) / a, -5, 5))
    array.push(x, rsi14 / 100)
    array.push(x, rsi56 / 100)
    array.push(x, clampF((c / c24 - 1) * 100, -30, 30))
    array.push(x, clampF((c / c168 - 1) * 100, -60, 60))
    array.push(x, a / c * 100)
    array.push(x, clampF(a / atrL, 0, 4))
    array.push(x, clampF(4 * sd / c * 100, 0, 40))
    array.push(x, clampF(nz(volume) / math.max(vma, 1e-9), 0, 8))
    array.push(x, (c - l24) / math.max(h24 - l24, 1e-12))
    array.push(x, (c - l480) / math.max(h480 - l480, 1e-12))
    array.push(x, (bar_index - lowIdx) / 24)
    array.push(x, clampF((c / lo720 - 1) * 100, 0, 300))
    array.push(x, (hiIdx - lowIdx) / 24)
    array.push(x, na(pdh) ? 0.5 : clampF((c - pdl) / math.max(pdh - pdl, 1e-12), -2, 3))
    array.push(x, na(pwh) ? 0.5 : clampF((c - pwl) / math.max(pwh - pwl, 1e-12), -2, 3))
    array.push(x, na(pdh) ? 0.0 : clampF((pdh - c) / a, -20, 20))
    array.push(x, na(pdl) ? 0.0 : clampF((c - pdl) / a, -20, 20))
    array.push(x, (c - open) / rng)
    array.push(x, (high - math.max(open, c)) / rng)
    array.push(x, (math.min(open, c) - low) / rng)
    array.push(x, math.sin(2 * math.pi * hr / 24))
    array.push(x, math.cos(2 * math.pi * hr / 24))
    array.push(x, (math.floor(time / 86400000) + 4) % 7)
    array.push(x, 0.0)
    x

// cermin untuk short: tren/momentum dibalik tanda, posisi dalam range dibalik, high ↔ low
f_mirror(x) =>
    y = array.copy(x)
    for j in array.from(0, 1, 2, 3, 4, 5, 8, 9, 23)
        array.set(y, j, -array.get(x, j))
    for j in array.from(6, 7, 14, 15, 19, 20)
        array.set(y, j, 1 - array.get(x, j))
    array.set(y, 21, array.get(x, 22))
    array.set(y, 22, array.get(x, 21))
    array.set(y, 24, array.get(x, 25))
    array.set(y, 25, array.get(x, 24))
    y

// skor model = perkiraan R per trade (setelah komisi)
f_score(x) =>
    s = ${m.f0}
${treeCode(m)}
    s

ready = bar_index >= WARM and not na(atrV) and atrV > 0 and not na(e480) and not na(lo720) and not na(c168)
float scL = na
float scS = na
if ready
    fx = f_feat()
    scL := f_score(fx)
    scS := f_score(f_mirror(fx))

// ═════════════ RENCANA TRADE (ledger) ═════════════
var bool  pAct = false
var int   pDir = 0
var int   pBar = 0
var float pE = na
var float pSL = na
var float pRK = na
var float pT1 = na
var float pT2 = na
var bool  pH1 = false
var float pAcc = 0.0
var float pScore = na
var int   nTr = 0
var int   nWin = 0
var float sumR = 0.0
var int   firstBar = na
f_rr(px) =>
    (px - pE) * pDir / pRK
ev = 0
float lastR = na
if barstate.isconfirmed and pAct and bar_index > pBar
    d = pDir
    done = false
    if d == 1 ? low <= pSL : high >= pSL
        px = bar_index == pBar + 1 ? pSL : d == 1 ? math.min(pSL, open) : math.max(pSL, open)
        pAcc := pAcc + (pH1 ? 0.5 : 1.0) * f_rr(px)
        done := true
        ev := pH1 ? 4 : 3
    else
        if not pH1 and (d == 1 ? high >= pT1 : low <= pT1)
            pH1 := true
            pAcc := pAcc + 0.5 * f_rr(pT1)
            pSL := pE
            ev := 1
        if pH1 and (d == 1 ? high >= pT2 : low <= pT2)
            pAcc := pAcc + 0.5 * f_rr(pT2)
            done := true
            ev := 2
        if not done and bar_index - pBar >= MAXB
            pAcc := pAcc + (pH1 ? 0.5 : 1.0) * f_rr(close)
            done := true
            ev := 5
    if done
        pAcc := pAcc - 0.002 * pE / pRK
        lastR := pAcc
        pAct := false
        nTr := nTr + 1
        sumR := sumR + pAcc
        if pAcc > 0
            nWin := nWin + 1

newDir = 0
if barstate.isconfirmed and ready and not pAct
    if na(firstBar)
        firstBar := bar_index
    bestD = scL >= scS ? 1 : -1
    bestS = math.max(scL, scS)
    if bestS >= thr and (sideI == 0 or sideI == bestD)
        newDir := bestD
        pAct := true
        pDir := bestD
        pBar := bar_index
        pE := close
        pRK := SLK * atrV
        pSL := close - bestD * pRK
        pT1 := close + bestD * pRK
        pT2 := close + bestD * 2 * pRK
        pH1 := false
        pAcc := 0.0
        pScore := bestS

plot(newDir, "Sinyal AI (+1 Buy / -1 Sell)", display = display.data_window)
plot(scL, "Skor AI Long (R)", display = display.data_window)
plot(scS, "Skor AI Short (R)", display = display.data_window)
plot(ready ? (bar_index - lowIdx) / 24 : na, "Hari sejak low 30 hari", display = display.data_window)
`;

  const DRAW = String.raw`
// ═════════════ GAMBAR ═════════════
var line  lE = na
var line  lS = na
var line  l1 = na
var line  l2 = na
var label bE = na
var label bS = na
var label b1 = na
var label b2 = na
var label bR = na
if showPlan and ev != 0 and not na(lE)
    if ev == 1
        label.set_text(b1, "TP1 ✓ 50%")
        line.set_style(lS, line.style_dashed)
        line.set_y1(lS, pE)
        line.set_y2(lS, pE)
        label.set_text(bS, "")
        label.set_text(bE, "ENTRY · SL pindah ke BE")
    if ev >= 2
        for ln in array.from(lE, lS, l1, l2)
            line.set_x2(ln, bar_index)
        for lb in array.from(bE, bS, b1, b2)
            label.set_x(lb, bar_index)
        tag = ev == 2 ? "TP2 ✓" : ev == 3 ? "SL" : ev == 4 ? "BE" : "Time exit"
        bR := label.new(bar_index, close, (lastR >= 0 ? "+" : "") + str.tostring(lastR, "#.##") + "R · " + tag, style = label.style_label_left, color = color.new(lastR > 0 ? colL : colS, 20), textcolor = color.white, size = size.small)
if showPlan and newDir != 0
    cc = newDir == 1 ? colL : colS
    tEnd = bar_index + MAXB
    label.new(bar_index, newDir == 1 ? low : high, (newDir == 1 ? "AI BUY" : "AI SELL") + "\nskor " + (pScore >= 0 ? "+" : "") + str.tostring(pScore, "#.###") + "R", style = newDir == 1 ? label.style_label_up : label.style_label_down, color = cc, textcolor = color.white, size = size.small, tooltip = "Skor = perkiraan rata-rata R trade ini menurut model (setelah komisi). Ambang " + str.tostring(thr, "#.###") + "R")
    lE := line.new(bar_index, pE, tEnd, pE, color = color.new(#2962ff, 0), width = 2)
    lS := line.new(bar_index, pSL, tEnd, pSL, color = colS, width = 2)
    l1 := line.new(bar_index, pT1, tEnd, pT1, color = color.new(colL, 30), style = line.style_dashed)
    l2 := line.new(bar_index, pT2, tEnd, pT2, color = colL, width = 2)
    bE := label.new(tEnd, pE, "ENTRY " + str.tostring(pE, format.mintick), style = label.style_label_left, color = color.new(color.black, 100), textcolor = #2962ff, size = size.small)
    bS := label.new(tEnd, pSL, "SL −1R · " + str.tostring(pSL, format.mintick), style = label.style_label_left, color = color.new(color.black, 100), textcolor = colS, size = size.small)
    b1 := label.new(tEnd, pT1, "TP1 1R 50% · " + str.tostring(pT1, format.mintick), style = label.style_label_left, color = color.new(color.black, 100), textcolor = colL, size = size.small)
    b2 := label.new(tEnd, pT2, "TP2 2R · " + str.tostring(pT2, format.mintick), style = label.style_label_left, color = color.new(color.black, 100), textcolor = colL, size = size.small)

// ═════════════ PANEL ═════════════
var table tb = table.new(position.top_right, 2, 9, bgcolor = color.new(chart.bg_color, 8), border_color = color.new(chart.fg_color, 85), border_width = 1)
fmtR(v) =>
    (v >= 0 ? "+" : "") + str.tostring(v, "#.###")
row(r, k, v, c) =>
    table.cell(tb, 0, r, k, text_color = color.new(chart.fg_color, 30), text_size = size.small, text_halign = text.align_left)
    table.cell(tb, 1, r, v, text_color = c, text_size = size.small, text_halign = text.align_left)
if barstate.islast and showTbl
    fg = chart.fg_color
    is1h = timeframe.in_seconds() == 3600
    table.cell(tb, 0, 0, "LUNA AI SIGNAL 1H", text_color = #F5C542, text_size = size.small)
    table.cell(tb, 1, 0, is1h ? "model aktif" : "⚠ model dilatih untuk 1H", text_color = is1h ? colL : colS, text_size = size.small)
    row(1, "Tingkat", iLevel, fg)
    row(2, "Skor sekarang", ready ? "Long " + fmtR(scL) + " · Short " + fmtR(scS) : "butuh ≥ " + str.tostring(WARM) + " candle (pilih 3000 bar)", ready ? fg : colS)
    row(3, "Ambang", "≥ " + fmtR(thr) + "R", fg)
    row(4, "Posisi", pAct ? (pDir == 1 ? "LONG" : "SHORT") + " sejak " + str.tostring(bar_index - pBar) + " candle" + (pH1 ? " · BE" : "") : "FLAT — menunggu", pAct ? (pDir == 1 ? colL : colS) : color.new(fg, 40))
    row(5, "Siklus", ready ? "hari ke-" + str.tostring((bar_index - lowIdx) / 24, "#.#") + " sejak low 30 hari" : "—", fg)
    days = na(firstBar) ? 0.0 : (bar_index - firstBar) / 24
    row(6, "Trade di chart", str.tostring(nTr) + (days > 0 ? " (" + str.tostring(nTr / days, "#.##") + "/hari)" : ""), fg)
    row(7, "Win rate", nTr > 0 ? str.tostring(100.0 * nWin / nTr, "#") + "%" : "—", fg)
    row(8, "Rata-rata", nTr > 0 ? fmtR(sumR / nTr) + "R/trade (net komisi)" : "—", nTr > 0 ? (sumR > 0 ? colL : colS) : fg)

alertcondition(newDir == 1, "Luna AI Buy", "Luna AI: BUY {{ticker}} @ {{close}}")
alertcondition(newDir == -1, "Luna AI Sell", "Luna AI: SELL {{ticker}} @ {{close}}")
`;

  const EXEC = String.raw`
// ═════════════ EKSEKUSI ═════════════
riskPct = input.float(1.0, "Risiko per trade (% equity)", minval = 0.1, maxval = 100, step = 0.1, group = "Strategy", tooltip = "Ukuran posisi = risiko / jarak SL, dibatasi 100% equity.")
var bool xBE = false
pos = strategy.position_size
idOf(d) =>
    d > 0 ? "Long" : "Short"
if ev >= 2 and pos != 0
    strategy.close_all(comment = ev == 5 ? "Time exit" : "Rencana selesai")
if pAct and pH1 and not xBE and pos != 0 and newDir == 0
    xBE := true
    strategy.exit("TP2", idOf(pDir), qty_percent = 100, stop = strategy.position_avg_price, limit = pT2)
if newDir != 0
    if pos != 0
        strategy.close_all(comment = "Rencana baru")
    xBE := false
    q = math.min(strategy.equity * riskPct / 100 / pRK, strategy.equity / pE)
    id = idOf(newDir)
    strategy.entry(id, newDir > 0 ? strategy.long : strategy.short, qty = q)
    strategy.exit("TP1", id, qty_percent = 50, stop = pSL, limit = pT1)
    strategy.exit("TP2", id, qty_percent = 100, stop = pSL, limit = pT2)
`;

  const indicator = `//@version=6
// Luna AI Signal 1H — dibuat oleh Luna (model ML, lihat tools/klctz). Bukan saran keuangan.
indicator("Luna AI Signal 1H", overlay = true, max_lines_count = 300, max_labels_count = 300)
${COMMON(MODEL, 'Normal (±5% skor teratas)')}${DRAW}`;
  const strategy = `//@version=6
// Luna AI Signal 1H — versi strategy. Order di open candle berikutnya, komisi 0,1%.
strategy("Luna AI Strategy 1H", overlay = true, initial_capital = 1000, default_qty_type = strategy.percent_of_equity, default_qty_value = 100, commission_value = 0.1, max_lines_count = 300, max_labels_count = 300)
${COMMON(MODEL, 'Normal (±5% skor teratas)')}${EXEC}${DRAW}`;

  const api = { indicator, strategy, MODEL };
  root.LunaAI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
