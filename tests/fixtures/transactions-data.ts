import { Pool } from "pg";
import { readdir, readFile } from "node:fs/promises";
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS } from "../../src/domain/settings";
import { e2eDatabaseUrl, testAccountKey } from "./transactions-env";

// Same v1 AES-256-GCM format as src/lib/crypto.ts, so the payout screen can show the number.
function encryptAccount(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(testAccountKey, "base64"), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}

export async function transactionFixtures() {
  const pool = new Pool({ connectionString: e2eDatabaseUrl(), connectionTimeoutMillis: 5000 });
  try {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    for (const file of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pool.query(await readFile(`supabase/migrations/${file}`, "utf8"));
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS))
      await pool.query("INSERT INTO settings(key,value) VALUES($1,$2)", [
        key,
        JSON.stringify(value),
      ]);
    const campusId = randomUUID(),
      categoryId = randomUUID(),
      pointId = randomUUID(),
      itemId = randomUUID();
    await pool.query("INSERT INTO campuses(id,name) VALUES($1,'Kampus E2E')", [campusId]);
    const people = [];
    for (const [index, name] of [
      "Pemilik E2E",
      "Penyewa E2E",
      "Admin E2E",
      "Pengguna Lain E2E",
    ].entries()) {
      const id = randomUUID(),
        token = randomBytes(32).toString("base64url");
      await pool.query(
        "INSERT INTO users(id,phone,name,campus_id,terms_accepted_at,terms_version,verification_status,role) VALUES($1,$2,$3,$4,now(),'test','terverifikasi',$5)",
        [id, `+62800000000${index}`, name, campusId, index === 2 ? "super_admin" : "user"],
      );
      await pool.query(
        "INSERT INTO sessions(user_id,token_hash,expires_at,user_agent,ip) VALUES($1,$2,now()+interval '6 hours','E2E local','127.0.0.1')",
        [id, createHash("sha256").update(token).digest("hex")],
      );
      if (index < 2)
        await pool.query(
          "INSERT INTO payout_accounts(user_id,type,provider,account_no_enc,account_name) VALUES($1,'ewallet','GoPay',$2,$3)",
          [id, encryptAccount(`08120000000${index}`), name],
        );
      people.push({ id, token });
    }
    await pool.query("INSERT INTO categories(id,name) VALUES($1,'Kamera E2E')", [categoryId]);
    await pool.query(
      "INSERT INTO pickup_points(id,campus_id,name,hours_json) VALUES($1,$2,'Lobi E2E',$3)",
      [
        pointId,
        campusId,
        JSON.stringify(Array.from({ length: 7 }, () => ({ open: "08:00", close: "20:00" }))),
      ],
    );
    await pool.query(
      "INSERT INTO items(id,owner_id,campus_id,category_id,title,description,item_value,price_per_day,deposit,min_days,max_days,status,published_at) VALUES($1,$2,$3,$4,'Kamera untuk tugas E2E','Kamera pengujian dalam kondisi baik, lengkap dengan tas dan baterai.',1000000,50000,100000,1,7,'aktif',now())",
      [itemId, people[0].id, campusId, categoryId],
    );
    await pool.query("INSERT INTO item_pickup_points(item_id,pickup_point_id) VALUES($1,$2)", [
      itemId,
      pointId,
    ]);
    const photo = `${people[0].id}/item_photo/${randomUUID()}.png`;
    await pool.query("INSERT INTO item_photos(item_id,path,thumb_path,sort) VALUES($1,$2,$2,0)", [
      itemId,
      photo,
    ]);
    const start =
      new Date(Date.now() + 2 * 86400000 + 7 * 3600000).toISOString().slice(0, 10) + "T10:00";
    return {
      owner: people[0],
      renter: people[1],
      admin: people[2],
      stranger: people[3],
      itemId,
      pointId,
      start,
    };
  } finally {
    await pool.end();
  }
}
