-- 0181 — the third module walked: inventory, from the rack to the surat jalan.
--
-- Written from `supabase/local/smoke/99_sim_inventory.sql`, which walks the
-- week before an opname as five people (gudang, a reader, procurement,
-- production, delivery), and from `scripts/e2e/walk-inventory.mjs`, which
-- presses the same buttons on the live screens. A status named here is one
-- the walk read back; a refusal named here is one it hit. The screens speak
-- English by default and Indonesian on the toggle (D318), so each button is
-- named in both: "Record difference" ("Catat selisih").
--
-- Three doors the walks found shut are fixed in 0180 and the location panel
-- (F176, F178, F179) and described here as they now work. One is still open
-- and waits on the owner (F177, Q59): it is the FAQ row marked *(sementara)*,
-- which the SOP prints under *Temuan* for as long as it stays.
--
-- The opname's own rules — how often, who approves a difference, whether the
-- rack photo comes through Chat or the screen — are **not decided** (Q57).
-- The steps describe what the system does today and say so; they do not
-- invent a rule.
--
-- How the screens are used, never what is on the rack (D296): no item, no
-- quantity and no price is named.

insert into ops_asst.processes (key, module, seq, title, purpose, route, permission, follows, sop_ref) values
('inv.locations', 'inventory', 10,
 'Lokasi stok (rak dan area)',
 'Setiap hitungan dan setiap gerak barang milik satu lokasi. Lokasi ditambah, diganti nama dan dinonaktifkan dari layar Opname oleh pemegang inventory.update, supaya area yang disepakati dengan lapangan tidak menunggu IT. Kodenya tetap selamanya; namanya bebas diubah.',
 '/inventory/penyesuaian', 'inventory.update', null, 'inventory/01'),

('inv.register_item', 'inventory', 20,
 'Mendaftarkan barang dari rak',
 'Barang yang ada di rak tapi belum ada di katalog didaftarkan dari layar Bahan & hardware: nama katalog (sistem) dan nama lapangan (yang dipakai tim), satu sampai empat foto, kategori, satuan, dan kalau sudah dihitung, jumlah dan raknya. Barang yang sudah ada di katalog cukup diberi nama lapangan.',
 '/inventory/material', 'inventory.create', 'inv.locations', 'inventory/02'),

('inv.receipt_stock', 'inventory', 30,
 'Barang datang menambah stok',
 'Stok bertambah saat penerimaan barang ditandatangani di procurement — gudang tidak mencatatnya lagi. Barang masuk ke lokasi rumah barangnya (atau GUDANG), dengan harga dari baris PO/PR-nya. Barang salah kirim atau dikembalikan ke pengirim tidak masuk stok.',
 '/procurement/tracker', 'procurement.create', 'inv.register_item', 'inventory/03'),

('inv.material_moves', 'inventory', 40,
 'Mengeluarkan, mengembalikan dan memindah material',
 'Material yang dipakai produksi dikeluarkan dengan menyebut Job Order-nya; sisa yang tidak terpakai dikembalikan; barang yang pindah rak dicatat sebagai pindah lokasi. Stok selalu dihitung dari semua gerak itu, tidak pernah diketik.',
 '/inventory/material', 'inventory.create', 'inv.receipt_stock', 'inventory/04'),

('inv.opname', 'inventory', 50,
 'Opname: hitung rak dan catat selisih',
 'Orang di depan rak mengisi jumlah yang benar-benar ada. Sistem menyimpan selisihnya terhadap catatan lokasi itu, bukan angka barunya, dan setiap selisih wajib beralasan. Frekuensi opname, siapa yang menyetujui selisih, dan bagaimana foto rak dikirim belum diputuskan pemilik; hari ini pemegang inventory.adjust mencatat selisih langsung, tanpa persetujuan dan tanpa foto.',
 '/inventory/penyesuaian', 'inventory.adjust', 'inv.material_moves', 'inventory/05'),

('inv.finished_goods', 'inventory', 60,
 'Barang jadi: dari Job Order sampai surat jalan',
 'Barang jadi punya raknya sendiri, per produk dan per pesanan klien. Hasil produksi masuk rak dengan menyebut Job Order-nya (pesanan kliennya ikut dari JO); pengiriman tidak dicatat lagi di gudang karena rak membaca surat jalan. Kelebihan produksi dan surplus dihitung sistem.',
 '/inventory/produk', 'inventory.create', 'inv.material_moves', 'inventory/06'),

('inv.assets', 'inventory', 70,
 'Register aset',
 'Aset perusahaan (alat, mesin, kendaraan, komputer, CCTV) dan barang sewa/leasing/pinjaman dicatat dengan nomor seri, lokasi dan pemegangnya, beserta riwayat servis dan statusnya.',
 '/inventory/assets', 'inventory.create', null, 'inventory/07'),

('inv.timber', 'inventory', 80,
 'Kayu log dan papan',
 'Kayu log diterima per nota (difoto, ditempel teks, atau diisi tangan), papan hasil gergajinya masuk rak papan, dan papan yang dipakai dicatat dengan pekerjaannya.',
 '/inventory/log', 'inventory.create', null, 'inventory/08'),

('inv.labels', 'inventory', 90,
 'Mencetak label',
 'Label berisi kode, nama, lokasi, tanggal didaftarkan dan QR kode barang, dicetak beberapa per lembar stiker A4. Membaca saja: pemegang inventory.read boleh mencetak.',
 '/inventory/label', 'inventory.read', 'inv.register_item', 'inventory/09');

insert into ops_asst.process_steps (process_key, seq, route, action, rule, status_before, status_after, writes, screenshot) values
-- lokasi
('inv.locations', 1, '/inventory/penyesuaian', 'Buka Inventory → Stock adjustments (Opname & penyesuaian). Di kartu "Manage locations" ("Kelola lokasi") isi kode dan nama rak, lalu tekan "Add location" ("Tambah lokasi").', 'Hanya pemegang inventory.update yang melihat kartu ini. Kode tidak bisa diganti sesudahnya — riwayat stok memakainya.', null, 'aktif', '{ops_inv.stock_locations}', 'inventory/walk-01-lokasi.jpg'),
('inv.locations', 2, '/inventory/penyesuaian', 'Untuk mengganti nama: tekan "Rename" ("Ganti nama") di baris lokasinya, ketik nama baru, lalu "Save name" ("Simpan nama").', 'Nama bebas diubah; kodenya tetap.', 'aktif', 'aktif', '{ops_inv.stock_locations}', null),
('inv.locations', 3, '/inventory/penyesuaian', 'Rak yang tidak dipakai lagi: tekan "Deactivate" ("Nonaktifkan"). Rak nonaktif bisa diaktifkan lagi dengan "Reactivate" ("Aktifkan lagi").', 'Tidak ada hapus: rak yang pernah dihitung tetap terbaca di riwayat, hanya tidak ditawarkan lagi.', 'aktif', 'nonaktif', '{ops_inv.stock_locations}', null),

-- daftar barang
('inv.register_item', 1, '/inventory/material', 'Buka Inventory → Materials & hardware, tekan "Register an item" ("Daftarkan barang"). Ambil atau pilih foto barangnya (satu sampai empat).', 'Tanpa foto ditolak (photo_required); lebih dari empat ditolak (too_many_photos).', null, null, '{}', null),
('inv.register_item', 2, '/inventory/material', 'Isi nama katalog (sistem, bahasa Inggris), nama lapangan (yang dipakai tim), kategori dan satuan. Kalau sudah dihitung, isi jumlah dan pilih raknya. Tekan "Register" ("Daftarkan").', 'Nama katalog atau nama lapangan yang sudah ada ditolak (already_catalogued) — hitung di barang yang sudah ada. Hitungan awal tercatat sebagai penyesuaian opname (butuh inventory.adjust) dan harus menyebut rak yang aktif. Kategori yang tidak dihitung di gudang ditolak (not_stocked).', null, 'terdaftar', '{ops_inv.register_item}', 'inventory/walk-04-daftar-barang.jpg'),
('inv.register_item', 3, '/inventory/material', 'Sesudah terdaftar, tekan "Print label" ("Cetak label") untuk labelnya, atau "Later" ("Nanti").', null, null, null, '{}', null),
('inv.register_item', 4, '/inventory/material', 'Barang yang sudah ada di katalog: klik barangnya, pada "Floor name" ("Nama lapangan") tekan "Edit" ("Ubah"), ketik namanya, lalu "Save" ("Simpan").', 'Nama lapangan ikut dicari seperti nama katalog; bukan barang kedua.', null, null, '{ops_inv.set_item_local_name}', null),
('inv.register_item', 5, '/inventory/material', 'Foto barang ditambah atau dibuang di bagian dokumen barang itu. Untuk mengganti foto terakhir, tambah foto barunya dulu, baru buang yang lama.', 'Barang harus punya minimal satu foto dan paling banyak empat — database menolak yang melewati batas.', null, null, '{}', null),

-- penerimaan
('inv.receipt_stock', 1, '/procurement/tracker', 'Procurement membuka Purchase Tracker, memilih vendornya, tekan "Record arrival", mengisi jumlah, foto barang dan foto surat jalan vendor, lalu "Record what arrived".', 'Foto barang wajib. Dengan surat jalan vendor penerimaan langsung ditandatangani (CONFIRMED) dan stok bertambah saat itu juga; dengan foto saja masih REPORTED dan stok bertambah saat ditandatangani.', null, 'CONFIRMED', '{ops_procure.create_receipt}', 'inventory/walk-06-penerimaan.jpg'),
('inv.receipt_stock', 2, '/inventory/material', 'Periksa di Materials & hardware: barangnya bertambah di lokasi rumahnya (atau GUDANG kalau belum punya), dengan harga dari baris PO/PR.', 'Tidak masuk stok: kondisi WRONG ITEM atau RETURN TO SENDER, kategori yang tidak dihitung di gudang, satuan beli yang tidak bisa dikonversi ke satuan stok, dan baris PO yang tidak menyebut barang maupun baris PR. DAMAGED tetap masuk — barangnya ada di gedung.', 'CONFIRMED', 'di rak', '{}', null),

-- pemakaian
('inv.material_moves', 1, '/inventory/material', 'Klik barangnya. Di laci barang pilih "Issue" ("Keluarkan"), isi jumlah, lokasi asal, nomor Job Order dan untuk apa, lalu tekan "Record" ("Catat").', 'Mengeluarkan lebih banyak dari yang tercatat tidak ditolak: tetap tercatat, dan barangnya ditandai minus — perlu dihitung ulang. Jumlah nol ditolak (qty_invalid). Tombol yang tertekan dua kali tidak mencatat dua kali.', null, 'keluar', '{ops_inv.issue_stock}', 'inventory/walk-07-keluar.jpg'),
('inv.material_moves', 2, '/produksi/jadwal', 'Material untuk satu Job Order juga bisa dikeluarkan sekaligus dari halaman Job Order-nya.', 'Barang yang bukan stok gudang ditolak dan disebut kodenya.', null, 'keluar', '{ops_inv.issue_for_work_order}', null),
('inv.material_moves', 3, '/inventory/material', 'Sisa yang tidak terpakai: pilih "Return" ("Kembalikan"), isi jumlah dan lokasinya, lalu "Record" ("Catat").', null, null, 'kembali', '{ops_inv.stock_moves}', null),
('inv.material_moves', 4, '/inventory/material', 'Pindah rak: pilih "Move location" ("Pindah lokasi"), isi jumlah, lokasi asal dan lokasi tujuan, lalu "Record" ("Catat").', 'Tercatat dua baris yang saling menutup; total stok tidak berubah. Lokasi asal dan tujuan tidak boleh sama.', null, 'pindah', '{ops_inv.stock_moves}', null),

-- opname
('inv.opname', 1, '/inventory/penyesuaian', 'Buka Stock adjustments. Di "Record a count" ("Catat hasil hitung") pilih barang dan lokasinya — sistem menampilkan jumlah yang tercatat di rak itu.', 'Satu hitungan milik satu rak, bukan satu total.', null, null, '{}', 'inventory/walk-09-opname.jpg'),
('inv.opname', 2, '/inventory/penyesuaian', 'Isi jumlah yang benar-benar ada di rak dan alasan selisihnya, lalu tekan "Record difference" ("Catat selisih").', 'Yang disimpan selisihnya, dengan alasan; tanpa alasan ditolak. Kalau hitungan sama dengan catatan, tidak ada yang ditulis. Butuh inventory.adjust. Siapa yang menyetujui selisih belum diputuskan pemilik — hari ini selisih langsung tercatat.', null, 'selisih tercatat', '{ops_inv.stock_moves}', null),
('inv.opname', 3, '/inventory/penyesuaian', 'Riwayat semua penyesuaian ada di bawahnya dan tidak pernah dihapus. Barang yang berulang kali kurang ditandai.', 'Pemegang inventory.read hanya melihat riwayat ini; formulir dan kelola lokasi tidak muncul.', null, null, '{}', null),

-- barang jadi
('inv.finished_goods', 1, '/inventory/produk', 'Buka Inventory → Finished Goods, tekan "Record a finished-goods move" ("Catat gerak barang jadi"), pilih "Production output" ("Hasil produksi"), pilih Job Order-nya, lokasinya dan jumlahnya, lalu "Save" ("Simpan").', 'Tanpa Job Order ditolak (wo_required); JO untuk produk lain (wo_other_product) atau yang dibatalkan (wo_cancelled) ditolak. Pesanan kliennya diambil dari JO, bukan dari formulir.', null, 'di rak barang jadi', '{ops_inv.move_product}', 'inventory/walk-10-barang-jadi.jpg'),
('inv.finished_goods', 2, '/inventory/produk', 'Sebelum dikirim, pindahkan barang jadinya ke lokasi rumah produk: "Move location" ("Pindah lokasi"), pilih produk, batch, dari lokasi, ke lokasi dan jumlahnya, lalu "Save" ("Simpan"). Lokasi rumah diatur dengan "Home location" ("Lokasi rumah").', 'Surat jalan mengurangi rak dari lokasi rumah produk (atau GUDANG). Memindah lebih banyak dari yang ada ditolak (insufficient).', 'di rak barang jadi', 'di lokasi rumah', '{ops_inv.move_product}', null),
('inv.finished_goods', 3, '/proyek/pengiriman', 'Tim pengiriman membuka Projects → Delivery. Di "Ready to ship" ("Siap kirim") tekan "Create delivery note" ("Buat surat jalan") pada proyeknya, isi jumlah per baris, sopir dan kendaraan, lalu "Dispatch" ("Berangkatkan").', 'Siap kirim dihitung dari progres Job Order (tahap terakhir), bukan dari rak barang jadi; lebih dari yang selesai ditolak (not_enough_made). Gudang tidak mencatat pengiriman lagi — rak barang jadi membaca surat jalan.', 'di lokasi rumah', 'IN_TRANSIT', '{ops_dlv.create_delivery}', 'inventory/walk-12-surat-jalan.jpg'),
('inv.finished_goods', 4, '/inventory/produk', 'Baca rak barang jadi per pesanan: dibuat, terkirim, di rak, kelebihan produksi dan surplus. Surplus bisa dipakai untuk pesanan lain dengan "Use for another order" ("Pakai untuk pesanan lain").', 'Hanya surplus yang boleh pindah ke pesanan lain dengan produk yang sama, dan harus beralasan. Yang masih menjadi hak pesanan asal tetap di sana.', null, null, '{ops_inv.allocate_product}', null),
('inv.finished_goods', 5, '/inventory/produk', 'Hitung rak barang jadi dengan "Count (opname)" ("Hitung (opname)"); barang rusak dengan "Damaged / scrapped" ("Rusak / afkir"); dijual lepas dengan "Sold outright" ("Dijual lepas"); kembali dari lokasi proyek dengan "Returned by client" ("Retur dari klien").', 'Selisih hitungan, rusak, dijual dan retur wajib beralasan (reason_required). Rusak/afkir dan hitungan butuh inventory.adjust.', null, null, '{ops_inv.count_product,ops_inv.move_product}', null),

-- aset
('inv.assets', 1, '/inventory/assets', 'Buka Inventory → Assets, tekan "Register asset" ("Daftarkan aset"). Isi nama, kategori, kepemilikan, nomor seri/plat, merek, model, lokasi, pemegang, tanggal dan harga beli kalau ada, lalu "Save" ("Simpan").', 'Nama dan kategori wajib (name_required, category_required). Aset sewa/leasing/pinjaman butuh biaya, periode dan tanggal jatuh tempo sewanya.', null, 'in_use', '{ops_inv.create_asset}', 'inventory/walk-13-aset.jpg'),
('inv.assets', 2, '/inventory/assets', 'Klik asetnya untuk mencatat servis atau perbaikan, dan untuk mengubah statusnya (dipakai, disimpan, diperbaiki, dilepas, hilang, dikembalikan).', 'Aset yang dilepas atau hilang wajib diberi keterangan (note_required). Hanya aset sewa/pinjaman yang bisa "dikembalikan".', 'in_use', null, '{ops_inv.add_asset_service,ops_inv.set_asset_status}', null),

-- kayu
('inv.timber', 1, '/inventory/log', 'Buka Inventory → Timber, catat kayu yang datang dari notanya: foto nota, tempel teksnya, atau isi tangan; periksa baris yang terbaca, lalu simpan.', 'Jenis kayu dan harga wajib (species_required, cost_required). Nota truk dan gergajian dicatat sebagai biaya tambahan muatan itu.', null, null, '{ops_inv.receive_logs}', null),
('inv.timber', 2, '/inventory/log', 'Papan yang dipakai dicatat dengan nomor pekerjaannya.', 'Tanpa pekerjaan ditolak (ref_required); lebih dari yang ada ditolak.', null, null, '{ops_inv.move_boards}', null),

-- label
('inv.labels', 1, '/inventory/label', 'Buka Inventory → Labels (atau "Print labels" dari layar barang, aset atau barang jadi). Pilih Materials, Assets atau Finished goods, centang yang dilabel, pilih ukuran lembar, lalu tekan "Print".', 'Membaca saja. QR-nya membuka halaman barang itu.', null, null, '{}', null);

insert into ops_asst.process_faq (process_key, question, answer) values
('inv.receipt_stock', 'Barang sudah datang tapi stok di gudang tidak bertambah. Kenapa?',
 'Stok bertambah saat penerimaannya ditandatangani (CONFIRMED). Kalau penerimaan masih REPORTED (dicatat dengan foto saja), lampirkan surat jalan vendor atau minta procurement menandatanganinya. Kalau sudah CONFIRMED, periksa kondisinya: WRONG ITEM dan RETURN TO SENDER memang tidak masuk stok, begitu juga barang di kategori yang tidak dihitung gudang atau yang satuan belinya tidak bisa dikonversi.'),
('inv.receipt_stock', 'Apakah gudang perlu mencatat barang masuk lagi?',
 'Tidak. Penerimaan yang ditandatangani di procurement langsung menambah stok di lokasi rumah barangnya. Mencatatnya lagi di gudang membuat stok dobel.'),
('inv.material_moves', 'Kenapa stok bisa minus?',
 'Mengeluarkan lebih banyak dari yang tercatat tidak ditolak, karena barangnya memang sudah keluar. Minus berarti ada yang tidak tercatat sebelumnya (barang masuk tanpa penerimaan, atau hitungan awal belum ada). Hitung raknya dan catat selisihnya di Stock adjustments.'),
('inv.opname', 'Siapa yang menyetujui selisih opname, dan seberapa sering opname dilakukan?',
 'Belum diputuskan pemilik. Hari ini pemegang izin penyesuaian (inventory.adjust) mencatat selisih langsung dengan alasannya, tanpa langkah persetujuan dan tanpa jadwal di sistem. Foto rak juga belum diminta, baik lewat Chat maupun layar. Semua selisih tersimpan dengan siapa yang mencatat dan alasannya, jadi bisa diperiksa belakangan.'),
('inv.opname', 'Hitungan saya sama dengan sistem, kenapa tidak ada yang tercatat?',
 'Opname menyimpan selisih, bukan angka barunya. Kalau selisihnya nol, tidak ada yang perlu dicatat — layar mengatakan "Matches" ("Cocok").'),
('inv.register_item', 'Barangnya sudah ada di katalog dengan nama Inggris, tim menyebutnya lain. Daftarkan lagi?',
 'Jangan. Buka barang yang sudah ada dan isi nama lapangannya. Mendaftarkan barang dengan nama yang sudah ada ditolak supaya tidak ada barang kembar.'),
('inv.finished_goods', 'Surat jalan ditolak "not_enough_made" padahal barang jadinya ada di rak.',
 'Siap kirim dihitung dari progres Job Order di produksi (tahap terakhir), bukan dari rak barang jadi. Minta produksi mencatat progresnya sampai tahap terakhir, lalu buat surat jalannya.'),
('inv.finished_goods', 'Lokasi barang jadi minus setelah surat jalan berangkat (sementara)',
 'Surat jalan mengurangi rak dari lokasi rumah produk (atau GUDANG), bukan dari rak tempat barangnya berada. Kalau barang jadinya masih di FINISHING saat dikirim, FINISHING tetap penuh dan lokasi rumahnya jadi minus. Sampai pemilik memutuskan aturannya (Q59): pindahkan barang jadi ke lokasi rumah produk sebelum surat jalan dibuat, atau atur lokasi rumah produk ke rak tempat barang jadinya disimpan.'),
('inv.assets', 'Apa bedanya aset dan barang di Materials & hardware?',
 'Barang di Materials & hardware dipakai habis dan stoknya dihitung dari gerak masuk-keluar. Aset dipakai berulang (alat, mesin, kendaraan), dicatat satu per satu dengan nomor seri dan pemegangnya, dan tidak punya stok.'),
('inv.opname', 'Bisakah John Lau memberi tahu stok suatu barang?',
 'Tidak. John Lau menjelaskan cara memakai layar inventory, bukan isi raknya. Stok, harga dan nilai dibaca di layar Materials & hardware atau Finished Goods oleh yang berhak.');
