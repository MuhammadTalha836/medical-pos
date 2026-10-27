# LAN Setup Guide: one main computer, several counters

**For:** the person who installs PharmaCare Pro in a pharmacy with more than one computer.
**Language:** each step is in English, with Roman Urdu under it.

> Ye guide us shakhs ke liye hai jo kisi aisi pharmacy mein PharmaCare Pro install kar raha hai jahan ek se zyada computer hain. Har step English mein hai, aur uske neeche Roman Urdu mein.

---

## 1. What LAN mode is

A shop with several computers keeps **all its data on one computer**, the **main computer**. The other computers are **counters**. They sell from the main computer's data over the shop's own network (router or switch). No internet is needed.

> Kai computers wali dukaan mein **sara data sirf ek computer par** hota hai, jise **main computer** kehte hain. Baqi computers **counters** hain. Wo dukaan ke apne network (router ya switch) ke zariye main computer ke data se sale karte hain. Internet ki zaroorat nahi.

- Stock, bills, shifts, customers and khata are the same on every counter at once.
  > Stock, bills, shifts, customers aur khata har counter par ek jaise aur foran update hote hain.
- Each counter prints its own receipts on its own printer.
  > Har counter apni receipt apne printer par print karta hai.
- The connection is encrypted. Only counters paired with a code from the main computer can connect.
  > Connection encrypted hai. Sirf wohi counter connect ho sakta hai jo main computer ke code se pair hua ho.
- A shop with one computer does not need any of this. It keeps working exactly as before.
  > Jis dukaan mein ek hi computer hai, use ye sab karne ki zaroorat nahi. Wo pehle ki tarah chalti rahegi.

| Computer | Has the data | What it does |
|---|---|---|
| Main computer | Yes, the only copy | Admin work, backups, reports. It can also sell. |
| Counter | No | Selling, returns, shifts, everything the user's role allows |

---

## 2. What you need

| Item | Why | Tip |
|---|---|---|
| A router or network switch | Connects the computers | Any normal home/office router works |
| Network cable (Cat 6) for the main computer | Wi-Fi drops cost sales | Counters may use Wi-Fi, but cable is better |
| UPS for the main computer **and** the router | If either goes off, every counter stops | Even a small UPS gives time to close properly |
| The same PharmaCare Pro version on every computer | Counters refuse a different version | Use one installer file for all |
| The Developer authenticator code | Needed on the main computer and to change a counter back | Only the Developer has it |

> **Zaroori cheezein:** router ya switch; main computer ke liye network cable (Wi-Fi par sale ruk sakti hai); main computer **aur** router dono ke liye UPS (inmein se koi bhi band hua to sab counters ruk jayenge); har computer par PharmaCare Pro ka **same version**; aur Developer ka authenticator code.

---

## 3. Before you start: the network

### 3.1 Give the main computer a fixed address

Counters find the main computer by its address, e.g. `192.168.1.10`. If the router gives it a new address after a restart, the counters cannot find it. Fix it once in the router:

1. Open the router page in a browser (usually `192.168.1.1` or `192.168.0.1`; the address and password are on a sticker under the router).
   > Browser mein router ka page kholein (aam tor par `192.168.1.1` ya `192.168.0.1`; address aur password router ke neeche sticker par likha hota hai).
2. Find **DHCP**, then **Address reservation** (also called *Static lease* or *Bind IP to MAC*).
   > **DHCP** dhoondein, phir **Address reservation** (kabhi iska naam *Static lease* ya *Bind IP to MAC* hota hai).
3. Pick the main computer from the list of connected devices and reserve its current address. Save, then restart the router.
   > Connected devices ki list mein se main computer chunein aur uska abhi wala address reserve kar dein. Save karein, phir router restart karein.

To see the main computer's address: in PharmaCare Pro open **Settings → Counters (LAN)** (after step 4), or in Windows run `ipconfig` and read **IPv4 Address**.

> Main computer ka address dekhne ke liye: PharmaCare Pro mein **Settings → Counters (LAN)** kholein (step 4 ke baad), ya Windows mein `ipconfig` chala kar **IPv4 Address** dekhein.

If you cannot open the router, you can set a fixed address in Windows instead (Network settings → Edit IP → Manual). Use one outside the router's automatic range, and write it down.

> Agar router nahi khul raha, to Windows mein hi fixed address set kar sakte hain (Network settings → Edit IP → Manual). Aisa address lein jo router ki automatic range se bahar ho, aur use likh lein.

### 3.2 Set the network to Private (every computer)

Windows → **Settings → Network & Internet →** your network → **Network profile type: Private**.

> Har computer par: Windows → **Settings → Network & Internet →** apna network → **Network profile type: Private**. "Public" par Windows firewall counters ko rok deta hai.

### 3.3 Stop the main computer from sleeping

Windows → **Settings → System → Power → Screen and sleep →** "When plugged in, put my device to sleep after": **Never**. The screen may still turn off.

> Main computer par: **Settings → System → Power → Screen and sleep →** sleep ko **Never** kar dein. Screen band ho sakti hai, lekin computer so na jaye.

---

## 4. Install the main computer

Choose the computer that is the strongest, has a cable, and stays on all day. If the shop already uses PharmaCare Pro on one computer, **that** computer becomes the main computer (see section 9).

> Woh computer chunein jo sabse acha ho, cable se juda ho, aur sara din on rahe. Agar dukaan pehle se ek computer par PharmaCare Pro chala rahi hai, to **wohi** main computer banega (section 9 dekhein).

1. Install PharmaCare Pro and complete the setup wizard as usual (store, Admin account, backups, license).
   > PharmaCare Pro install karein aur setup wizard aam tareeqe se mukammal karein (store, Admin account, backup, license).
2. Sign in as the **Developer**. Open **Developer → Network (LAN)**.
   > **Developer** ke tor par login karein. **Developer → Network (LAN)** kholein.
3. Choose **Several computers: this is the main computer (on)**. Leave the port at **4545** unless another program uses it. Press **Save**, then **Restart now**. Until the Developer does this, the Admin has no Counters tab at all.
   > **Several computers: this is the main computer (on)** chunein. Jab tak Developer ye on na kare, Admin ko Counters ka tab nazar hi nahi aata. Port **4545** hi rehne dein (jab tak koi aur program use na kar raha ho). **Save** dabayein, phir **Restart now**.
4. After the restart the header shows **Main computer**, and a PharmaCare Pro icon appears near the clock (system tray).
   > Restart ke baad header mein **Main computer** likha aayega, aur ghari ke paas (system tray) PharmaCare Pro ka icon aa jayega.
5. Sign in as the Admin. Open **Settings → Counters (LAN)**.
   > Admin ke tor par login karein. **Settings → Counters (LAN)** kholein.
6. Press **Allow through firewall**. Windows asks for administrator approval: press **Yes**.
   > **Allow through firewall** dabayein. Windows administrator ki ijazat maangega: **Yes** dabayein.
7. Tick **Start with Windows**, so the app opens by itself every morning.
   > **Start with Windows** par tick karein, taake har subah app khud khul jaye.
8. Write down the **Address**, **Port** and **Security code** shown on this screen. You need them for every counter.
   > Is screen par likha **Address**, **Port** aur **Security code** likh lein. Har counter ke liye ye chahiye honge.

**The window close button on the main computer only hides the window.** The app keeps running in the tray so counters keep working. To really close it, right-click the tray icon → **Quit**; it asks first, because every counter stops.

> **Main computer par window band karne se app band nahi hoti,** sirf chhup jaati hai, taake counters chalte rahein. Asal mein band karne ke liye tray icon par right-click → **Quit**; ye pehle poochega, kyunke is se sab counters ruk jayenge.

### 4.1 If the firewall button does not work

Open **Command Prompt as administrator** on the main computer and run (change 4545 if you chose another port):

> Agar firewall wala button kaam na kare, to main computer par **Command Prompt as administrator** khol kar ye chalayein (agar port badla hai to 4545 ki jagah wo likhein):

```
netsh advfirewall firewall add rule name="PharmaCare Pro Server" dir=in action=allow protocol=TCP localport=4545 profile=private
```

If the shop uses another antivirus/firewall (e.g. a paid antivirus), allow PharmaCare Pro or TCP port 4545 there too.

> Agar dukaan mein koi aur antivirus/firewall hai, to us mein bhi PharmaCare Pro ya TCP port 4545 ko allow karein.

---

## 5. Install each counter

Do this on every counter, one at a time.

> Ye har counter par, ek ek kar ke, karein.

1. Install the **same version** of PharmaCare Pro.
   > PharmaCare Pro ka **same version** install karein.
2. Open it. On the first screen (setup), press **This computer is a counter** at the bottom. Do **not** complete the setup wizard on a counter.
   > App kholein. Pehli screen (setup) par neeche **This computer is a counter** dabayein. Counter par setup wizard mukammal **na** karein.
   - A computer that already ran PharmaCare Pro on its own: sign in as the Developer → **Developer → Network (LAN) → Make this a counter**. Its old data stays on it untouched, but is not used while it is a counter.
     > Agar is computer par pehle se PharmaCare Pro akela chal raha tha: Developer login → **Developer → Network (LAN) → Make this a counter**. Iska purana data isi par mehfooz rehta hai, lekin counter bante waqt istemal nahi hota.
3. On the main computer: **Settings → Counters (LAN) → Make pairing code**. A 6-digit code appears. It works **once**, for **5 minutes**.
   > Main computer par: **Settings → Counters (LAN) → Make pairing code**. 6 hindson ka code aayega. Ye **sirf ek baar**, **5 minute** ke liye chalta hai.
4. On the counter fill in:
   > Counter par ye bharein:
   - **Main computer address**: e.g. `192.168.1.10`
   - **Port**: `4545`
   - **Pairing code**: the 6 digits / wo 6 hindse
   - **Name of this counter**: e.g. `Counter 1`, `Front counter`. This name appears on bills, shifts and receipts.
     > Ye naam bills, shifts aur receipt par aayega.
5. Press **Connect**. The counter shows the main computer's **security code**. Check that it is **exactly the same** as the one on the main computer's Counters screen.
   > **Connect** dabayein. Counter main computer ka **security code** dikhayega. Check karein ke ye main computer ki Counters screen wale code se **bilkul same** hai.
   - Same → press **They match, pair now**. The counter restarts and shows the sign-in screen with the store's name.
     > Same hai → **They match, pair now** dabayein. Counter restart ho kar store ke naam ke saath login screen dikhayega.
   - Different → **stop**. Something else on the network is answering. Check the address and ask the network person.
     > Alag hai → **ruk jayein**. Network par koi aur cheez jawab de rahi hai. Address check karein aur network wale se poochein.
6. On the main computer the new counter appears in the **Counters** list as **Online**.
   > Main computer par naya counter **Counters** list mein **Online** dikhega.
7. Set up the counter's receipt printer: **Settings → Invoice → Receipt Printer** on that counter (each computer keeps its own printer). Print a test receipt.
   > Counter ka printer set karein: usi counter par **Settings → Invoice → Receipt Printer** (har computer ka apna printer setting hota hai). Test receipt print karein.

Five wrong codes from one computer lock pairing from it for 15 minutes. Then make a new code.

> Ek computer se 5 dafa ghalat code daalne par 15 minute ke liye pairing band ho jaati hai. Uske baad naya code banayein.

---

## 6. First test (do this before leaving the shop)

1. On **Counter 1**: sign in as a cashier, **Start Shift**, sell one medicine, print the receipt. The receipt shows `Counter 1`.
   > **Counter 1** par cashier login, **Start Shift**, ek dawai bechein, receipt print karein. Receipt par `Counter 1` likha hoga.
2. On the **main computer**: the stock of that medicine went down, **Sales History** shows the bill with `Counter 1`, and **Shifts** shows the shift with `Counter 1`.
   > **Main computer** par: us dawai ka stock kam hua, **Sales History** mein bill `Counter 1` ke saath, aur **Shifts** mein shift `Counter 1` ke saath nazar aaye.
3. Pull the main computer's network cable for a minute. The counter's header turns red (**reconnecting**). Plug it back: it turns green again by itself.
   > Main computer ki network cable ek minute ke liye nikaal dein. Counter ke header mein laal (**reconnecting**) aayega. Cable wapas lagayein: khud hi hara ho jayega.
4. Repeat steps 1–2 on every counter.
   > Har counter par step 1–2 dobara karein.

---

## 7. Daily use (tell the staff)

- **Switch on the router and the main computer first**, then the counters. Shut down the counters first in the evening, the main computer last.
  > **Subah pehle router aur main computer on karein**, phir counters. Shaam ko pehle counters band karein, main computer sabse aakhir mein.
- **When the main computer is off or the network is down**, the counter's header turns red (*reconnecting*), and a counter switched on at that time shows *Connecting to the main computer* and keeps trying on its own. Nothing can be sold until it is back. A bill already in the POS stays there; press **F9** again when connected. A bill is never saved twice.
  > **Jab main computer band ho ya network na ho,** counter ke header mein laal (*reconnecting*) aayega, aur us waqt on kiya gaya counter *Connecting to the main computer* dikha kar khud koshish karta rahega. Wapas aane tak sale nahi hogi. POS mein jo bill bana hua hai wo wahin rehta hai; connect hone par dobara **F9** dabayein. Bill kabhi do dafa save nahi hota.
- **One login at a time:** a cashier who signs in on another counter is signed out from the first one. The Admin may be signed in on several computers.
  > **Ek waqt mein ek login:** cashier agar doosre counter par login kare, to pehle counter se khud logout ho jayega. Admin kai computers par ek saath login reh sakta hai.
- **A shift belongs to the counter where it was opened.** Selling from another computer shows *Your shift is open on Counter 2*. Sell from that counter, or close the shift there and open a new one here.
  > **Shift usi counter ki hoti hai jahan kholi gayi.** Doosre computer se sale karne par *Your shift is open on Counter 2* aayega. Usi counter se sale karein, ya wahan shift band kar ke yahan nayi kholein.
- **Only on the main computer:** Developer sign-in, setup, restoring a backup, choosing backup folders and changing the network setting.
  > **Sirf main computer par:** Developer login, setup, backup restore, backup folder chunna, aur network setting badalna.
- **Backups** are made only on the main computer, because only it has the data. Counters need no backup.
  > **Backup** sirf main computer par banta hai, kyunke data sirf usi par hai. Counters ka backup nahi chahiye.

---

## 8. Changes later

### 8.1 Add a counter
Repeat section 5 with a new code.
> Naye code ke saath section 5 dobara karein.

### 8.2 Rename a counter
Main computer → **Settings → Counters (LAN)** → pencil button. New bills use the new name; old bills keep the old one.
> Main computer → **Settings → Counters (LAN)** → pencil button. Naye bills naya naam lenge; purane bills purana naam rakhenge.

### 8.3 A counter is lost, sold, stolen or replaced
Main computer → **Settings → Counters (LAN)** → **Remove access**. That computer stops working at once and everyone on it is signed out. Its old bills stay. To use a computer again after removing it, pair it with a new code.
> Main computer → **Settings → Counters (LAN)** → **Remove access**. Wo computer foran band ho jayega aur us par sab logout ho jayenge. Uske purane bills mehfooz rehte hain. Dobara use karna ho to naye code se pair karein.

### 8.4 Turn a counter back into a single computer
On the counter's *Connecting* or setup screen press **Leave counter mode** and enter the **Developer authenticator code**. It restarts with its own (old) data.
> Counter ki *Connecting* ya setup screen par **Leave counter mode** dabayein aur **Developer authenticator code** daalein. Ye apne (purane) data ke saath restart ho jayega.

### 8.5 Updating to a new version
1. Update the **main computer first**.
   > Pehle **main computer** update karein.
2. Then update every counter. Until a counter is updated it shows *Please update this computer* and does not sell.
   > Phir har counter update karein. Jab tak counter update na ho, *Please update this computer* dikhayega aur sale nahi karega.

Do the update after closing time, when no one is selling.
> Update dukaan band hone ke baad karein, jab koi sale na kar raha ho.

---

## 9. A shop that already uses PharmaCare Pro

**Data on two computers is never joined together.** Only the main computer's data is used.

> **Do computers ka data kabhi aapas mein jorha nahi jata.** Sirf main computer ka data chalta hai.

1. Pick the computer with the real, up-to-date data (stock, khata, bills) as the main computer. Take a backup on it first.
   > Jis computer par asal aur taaza data hai (stock, khata, bills), use main computer banayein. Pehle us par backup lein.
2. Set it up as in section 4 (it keeps all its data).
   > Use section 4 ki tarah set karein (iska sara data rehta hai).
3. On every other computer: **Developer → Network (LAN) → Make this a counter**, then section 5. Their own data stays on them but is not used. If they had sales that are not on the main computer, enter those on the main computer by hand first.
   > Baqi har computer par: **Developer → Network (LAN) → Make this a counter**, phir section 5. Unka apna data unhi par rehta hai lekin use nahi hota. Agar un par aisi sales thin jo main computer par nahi hain, to pehle wo main computer par haath se darj karein.

---

## 10. If the main computer breaks (disaster recovery)

1. On the new main computer: install the same version, run the setup wizard, then **Backup & Recovery → Restore** the latest backup (from the backup folder, USB or online backup).
   > Naye main computer par: same version install karein, setup wizard chalayein, phir **Backup & Recovery → Restore** se aakhri backup wapas layein (backup folder, USB ya online backup se).
2. Do section 4 steps 2–8 on it. **Give it the old main computer's fixed address** in the router (section 3.1), if possible.
   > Is par section 4 ke step 2–8 karein. Ho sake to router mein ise **purane main computer wala fixed address** dein (section 3.1).
3. The new computer has a new security code, so every counter says *different security certificate*. Pair each counter again with a new code (section 5). On the main computer, **Remove access** for the old counter entries.
   > Naye computer ka security code naya hota hai, is liye har counter *different security certificate* kahega. Har counter ko naye code se dobara pair karein (section 5). Main computer par purani counter entries ko **Remove access** kar dein.

---

## 11. Troubleshooting

| What you see | Likely cause | What to do |
|---|---|---|
| Counter: *The main computer refused the connection* | The app is not open on the main computer, or it is not set as Main computer | Open PharmaCare Pro on the main computer; check **Developer → Network (LAN)** says Main computer |
| Counter: *cannot be reached* / keeps *Connecting* | Firewall, wrong address, network cable, different network | Press **Allow through firewall** (or the `netsh` command, 4.1); check the address in **Settings → Counters (LAN)**; both computers on the same router; network profile **Private** |
| It worked yesterday, not today | The main computer's address changed | Reserve the address in the router (3.1). On the counter: **Change main computer**, enter the new address and a new code |
| *Different security certificate. Pair this counter again* | The main computer was reinstalled or replaced, or something else answers on that address | If the main computer was changed: pair again (section 10). If not: stop and check the network |
| *Please update this computer* | Versions differ | Install the main computer's version on this counter (8.5) |
| *Wrong pairing code* / *code has expired* / *already used* | The code is wrong, older than 5 minutes, or was used | Make a new code on the main computer |
| *Too many wrong codes* | 5 wrong tries | Wait 15 minutes, make a new code |
| *This counter was removed on the main computer* | Someone pressed **Remove access** | Pair again with a new code, if that was a mistake |
| *Your shift is open on Counter 2* | The cashier's shift is on another counter | Sell there, or close it there and open a new one here |
| A cashier is signed out by itself | They signed in on another counter | Normal: one login per cashier |
| *This can only be done on the main computer* | Developer, setup, restore, backup folders or network settings tried from a counter | Do it on the main computer |
| Slow on a counter | Weak Wi-Fi | Use a cable, or move the router closer |
| Main computer: the port could not start (message at start-up) | Another program uses 4545 | **Developer → Network (LAN)**: choose another port (e.g. 4546), restart, allow the firewall again, re-pair counters with the new port |

> **Masle aur hal (khulasa):** counter connect na ho to pehle dekhein ke main computer par app khuli hai, firewall allow hai, address theek hai, aur dono computer ek hi router par hain (network **Private**). Address badal gaya ho to router mein reserve karein. *Different security certificate* aaye aur main computer nahi badla, to ruk jayein aur network check karein. Version alag ho to counter update karein.

---

## 12. Frequently asked questions

**Is internet needed?** No. Only the shop's own network. (Online backup, if used, needs internet on the main computer only.)
> **Internet chahiye?** Nahi. Sirf dukaan ka apna network. (Online backup ke liye sirf main computer par internet chahiye.)

**How many counters?** Up to about 5 work well on one main computer. Busy shops should give the main computer a cable and a good SSD.
> **Kitne counters?** Ek main computer ke saath taqreeban 5 tak acha chalte hain. Masroof dukaan mein main computer ko cable aur acha SSD dein.

**Can the main computer also sell?** Yes, it is a counter too (named *Main computer*).
> **Main computer bhi sale kar sakta hai?** Haan, wo bhi counter hai (naam *Main computer*).

**Can two counters sell the last box at the same time?** No. The main computer checks stock for each bill; one sells, the other is told there is not enough stock.
> **Do counters aakhri dabba ek saath bech sakte hain?** Nahi. Main computer har bill par stock check karta hai; ek bik jayega, doosre ko stock kam hone ka bataya jayega.

**Can someone's laptop on the shop Wi-Fi get in?** Not without a pairing code made on the main computer by the Admin, and then the user still needs a staff login.
> **Koi apna laptop Wi-Fi par laga kar andar aa sakta hai?** Nahi, jab tak Admin main computer par pairing code na banaye; aur uske baad bhi staff login chahiye.

**Where is the data?** Only on the main computer. That is why the main computer needs the UPS and the backups.
> **Data kahan hai?** Sirf main computer par. Isi liye main computer ko UPS aur backup chahiye.

---

## 13. Acceptance checklist (sign before handing over)

- [ ] Main computer has a fixed address (router reservation), network profile Private, sleep off, UPS.
- [ ] **Developer → Network (LAN)** shows Main computer; header shows *Main computer*.
- [ ] **Allow through firewall** done; **Start with Windows** ticked.
- [ ] Every counter paired; the security code was compared on each; all show **Online**.
- [ ] Test sale on every counter: stock goes down on the main computer, bill and shift show the counter name, receipt prints on the counter's printer.
- [ ] Cable pulled and plugged back: the counter reconnects by itself.
- [ ] A cashier signing in on a second counter is signed out from the first.
- [ ] A shift opened on Counter 1 cannot sell from Counter 2.
- [ ] Main computer quit from the tray: the counters' header turns red; reopened: it turns green and selling continues.
- [ ] Backup runs on the main computer; Restore and Developer sign-in are refused on counters.
- [ ] The staff know: main computer on first, off last.

> **Handover se pehle check list:** upar wali har cheez test kar ke tick karein, aur dukaan walon ko batayein ke main computer subah sabse pehle on aur shaam ko sabse aakhir mein band hota hai.
