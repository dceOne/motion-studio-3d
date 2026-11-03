// api/generate.js
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const SYSTEM_PROMPT = `Anda adalah ahli grafis 3D dan Three.js. Buatlah kode animasi 3D deterministik berbasis Three.js berdasarkan instruksi.
ATURAN WAJIB:
1. Kembalikan HANYA kode JavaScript murni, tanpa markdown \`\`\`javascript atau penjelasan apapun.
2. Kode harus mendeklarasikan dua fungsi global: setup(api) dan update(st, t, o).
3. function setup(api):
   - api berisi: { scene, camera, renderer, o }
   - o berisi konfigurasi: { dur, fps, solid, aspect, w, h }
   - Buat geometry, material, mesh, lampu. Tambahkan ke api.scene.
   - JANGAN panggil renderer.render() atau mengubah ukuran canvas.
   - Kembalikan sebuah object state (st) yang berisi referensi ke objek-objek yang perlu dianimasikan (misal: mesh, material).
4. function update(st, t, o):
   - st: objek state dari setup.
   - t: waktu saat ini dalam detik (dari 0 hingga o.dur).
   - o: konfigurasi yang sama.
   - Update rotasi, posisi, warna, atau parameter material murni berdasarkan variabel 't'. Ini membuat animasi deterministik.
   - Jangan gunakan Date.now() atau Math.random().
5. Variabel Bebas Tersedia:
   - THREE (modul Three.js)
   - R() (fungsi random deterministik 0..1)
   - TAU (Math.PI * 2)
6. Jika latar belakang transparan (o.solid === false), pastikan material cocok (gunakan transparent: true jika perlu).
7. Jika ada previousCode dan error, perbaiki error tersebut.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Hanya menerima method POST' });
  }

  // Rate limit sederhana berbasis IP (Hanya ilustrasi ringan untuk Vercel)
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  // Implementasi rate-limit production biasanya menggunakan Redis, di sini dilewati agar file mandiri.

  const apiKey = process.env.GEMINI_API_KEY;
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  if (!apiKey) {
    return res.status(500).json({ error: 'Kunci API Gemini tidak dikonfigurasi di server.' });
  }

  try {
    const { image, brief, previousCode, instruction, error } = req.body;
    let promptText = "";

    if (previousCode && error) {
      promptText = `KODE SEBELUMNYA:\n${previousCode}\n\nERROR SAAT VALIDASI:\n${error}\n\nInstruksi Koreksi: ${instruction || 'Perbaiki error tersebut agar animasi berjalan.'}`;
    } else {
      promptText = `Buat animasi Three.js. Deskripsi: ${brief || 'Buat animasi abstrak berputar'}.`;
      if (instruction) promptText += `\nKoreksi: ${instruction}`;
    }

    const contents = [{
      role: 'user',
      parts: []
    }];

    if (image) {
      // image: data:image/png;base64,iVBOR...
      const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) return res.status(400).json({ error: 'Format gambar base64 tidak valid.' });
      
      const mimeType = match[1];
      const base64Data = match[2];
      
      // Ukuran max 4MB (base64 ~33% lebih besar)
      const sizeInBytes = (base64Data.length * (3 / 4)) - (base64Data.indexOf('=') > 0 ? (base64Data.length - base64Data.indexOf('=')) : 0);
      if (sizeInBytes > 4 * 1024 * 1024) {
        return res.status(400).json({ error: 'Ukuran gambar maksimal 4 MB.' });
      }

      contents[0].parts.push({
        inlineData: { mimeType, data: base64Data }
      });
    }

    contents[0].parts.push({ text: promptText });

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: {
          temperature: 0.2,
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API Error:", data);
      return res.status(500).json({ error: data.error?.message || 'Gagal menghubungi Gemini API.' });
    }

    let generatedText = data.candidates[0].content.parts[0].text;
    
    // Bersihkan markdown code block jika model masih mengeluarkannya
    generatedText = generatedText.replace(/^```javascript\n?/gm, '').replace(/^```\n?/gm, '').trim();

    return res.status(200).json({ code: generatedText });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
}