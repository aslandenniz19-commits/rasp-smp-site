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

## Önemli notlar

- **Ödeme entegrasyonu yoktur.** Mağaza sipariş kaydı tutar; ödeme alma işini (Discord, havale, vb.) sen yürütürsün. İstersen PayTR / iyzico gibi bir ödeme sağlayıcısı sonradan eklenebilir.
- **Oyun içi teslimat otomatik değildir.** Siparişi panelden "Teslim Et" yapınca oyunda komutu elle çalıştırırsın. Plugin ile bağlamak ayrı bir iş.
- Veriler `data/db.json` dosyasındadır. **Yedeklemeyi unutma.** `data/` klasörünü paylaşma / GitHub'a yükleme.
- Gerçek bir alan adında yayınlarken HTTPS kullan (Nginx / Caddy / Cloudflare arkasında). Proxy arkasındaysan `TRUST_PROXY=1` ayarla.
- Sunucu durumu `api.mcsrvstat.us` ile ziyaretçinin tarayıcısından sorgulanır.
