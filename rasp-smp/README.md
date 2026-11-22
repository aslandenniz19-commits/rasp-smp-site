# RASP SMP – Site + Yönetim Paneli

Harici paket gerektirmez; sadece **Node.js 18+** yeterli.

## Çalıştırma

```bash
node server.js
# veya: npm start
```

Tarayıcıda `http://localhost:3000` adresini aç. Port için: `PORT=8080 node server.js`

## İlk kurulum

1. Siteyi aç ve **Kayıt Ol**'a bas.
2. **İlk kayıt olan hesap otomatik SAHİP olur** (tüm yetkiler). Bunu sen yap.
3. Üstteki **Yönetim Paneli** → **Site Ayarları**'ndan sunucu adı, IP, Discord, kurallar ve ödeme notunu düzenle.

## Özellikler

- Kayıt / giriş (scrypt ile şifreleme, HttpOnly oturum çerezi, giriş denemesi sınırı)
- Ana sayfa: sunucu IP'si (kopyala butonu), canlı oyuncu sayısı, duyurular, kurallar
- Mağaza: kategori filtresi, sipariş oluşturma, "Siparişlerim"
- Destek: talep açma, yetkili ile yazışma, talebi kapatma
- Başvuru: açık formlar, oyuncunun başvurusunu gönderip durumunu görmesi
- Yönetim paneli (sadece sahip olduğun yetkiler görünür)
  - Kullanıcılar & Yetki: istediğin kişiye tek tek yetki ver/al, rütbe etiketi yaz, engelle, şifre sıfırla
  - Mağaza ürünleri, siparişler (teslim / iptal)
  - Destek talepleri
  - Başvuru formu oluşturma (kendi sorularını yaz) ve başvuruları kabul / red
  - Duyurular, site ayarları

## Yetkiler

| Yetki | Ne yapabilir |
|---|---|
| users | Kullanıcılara yetki verir, engeller, şifre sıfırlar |
| products | Mağaza ürünlerini ekler / düzenler / siler |
| orders | Siparişleri teslim eder / iptal eder |
| tickets | Tüm destek taleplerini görür ve yanıtlar |
| forms | Başvuru formu oluşturur / düzenler |
| applications | Başvuruları kabul / reddeder |
| announcements | Duyuru yayınlar / siler |
| settings | Site ayarlarını değiştirir |

Kurallar: Sahip hesabı değiştirilemez. Yetki veren kişi, kendinde olmayan bir yetkiyi başkasına veremez.

## Kartla ödeme (PayTR)

Kart bilgisi bu sitede **hiç girilmez veya saklanmaz**. Oyuncu "Kartla öde"ye basınca PayTR'ın güvenli kart sayfası pencerede açılır, para PayTR üzerinden senin banka hesabına yatar.

1. PayTR'da mağaza hesabı aç ve onaylat (üyelik şartlarını PayTR'ın başvuru sayfasından kontrol et).
2. Sitede **Yönetim Paneli → Kartla Ödeme** sekmesine (sadece Sahip görür) PayTR'dan aldığın **Mağaza no, Mağaza anahtarı, Mağaza gizli anahtarı (salt)** değerlerini gir. İstersen bunları ortam değişkeni olarak da verebilirsin: `PAYTR_MERCHANT_ID`, `PAYTR_MERCHANT_KEY`, `PAYTR_MERCHANT_SALT` (ayrıca `PAYTR_TEST_MODE=1`).
3. PayTR mağaza panelinde **Bildirim URL** alanına sekmede yazan adresi gir: `https://alanadin.com/api/paytr/callback`
4. Önce **Test modu** açıkken dene, sonra kapat.

Ödeme başarılı olunca PayTR sitene imzalı bildirim yollar, sipariş otomatik **Ödendi** olur. Sen panelden "Teslim Et" ile oyunda teslimi yapıp kapatırsın.

Gerekenler: site **https** ile ve internetten erişilebilir bir adreste yayında olmalı (PayTR bildirimi sana ulaşabilsin). Proxy arkasındaysan `TRUST_PROXY=1` ve gerekirse `BASE_URL=https://alanadin.com` ayarla. Kart bilgilerini bu sitenin kendi formuna eklemeye çalışma; bu PCI-DSS kurallarına aykırıdır.

PayTR anahtarları `data/db.json` içinde düz metin durur. Daha güvenli olması için ortam değişkenini tercih et ve `data/` klasörünü kimseyle paylaşma.

## Yayına alma: https://raspsmpdfgre.com.tr

Siteyi bir sunucuda (VPS, Ubuntu gibi) çalıştırman ve alan adını o sunucunun IP adresine yönlendirmen gerekir. Alan adı bu siteyi kendiliğinden açmaz.

1. **DNS:** Alan adını aldığın yerde `raspsmpdfgre.com.tr` ve `www` için **A kaydı** oluştur, sunucunun IP adresini yaz.
2. **Sunucuya kur:** Node.js 20 veya üstünü kur, klasörü `/opt/rasp-smp` içine koy.
3. **Ayar:** `.env.example` dosyasını `.env` olarak kopyala, doldur (`BASE_URL` zaten `https://raspsmpdfgre.com.tr`).
4. **Çalıştır:** `deploy/rasp-smp.service` dosyasını `/etc/systemd/system/` içine koyup `systemctl enable --now rasp-smp` de. (Elle denemek için: `node --env-file=.env server.js`)
5. **HTTPS:** Caddy kur, `deploy/Caddyfile` dosyasını kullan. Sertifikayı kendisi alır.
6. **PayTR Bildirim URL:** `https://raspsmpdfgre.com.tr/api/paytr/callback`

Sunucuda 80 ve 443 portları açık olmalı. 3000 portu dışarıya açılmamalı (site sadece Caddy üzerinden erişilir).

## Önemli notlar

- Havale/EFT ödemelerini elle kontrol edip "Teslim Et" yaparsın; kartla ödeme (PayTR) otomatik "Ödendi" olur.
- **Oyun içi teslimat otomatik değildir.** Siparişi panelden "Teslim Et" yapınca oyunda komutu elle çalıştırırsın. Plugin ile bağlamak ayrı bir iş.
- Veriler `data/db.json` dosyasındadır. **Yedeklemeyi unutma.** `data/` klasörünü paylaşma / GitHub'a yükleme.
- Gerçek bir alan adında yayınlarken HTTPS kullan (Nginx / Caddy / Cloudflare arkasında). Proxy arkasındaysan `TRUST_PROXY=1` ayarla.
- Sunucu durumu `api.mcsrvstat.us` ile ziyaretçinin tarayıcısından sorgulanır.
