import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "@/src/db";
import { campuses, users } from "@/src/db/schema";
import { filterCampuses } from "@/src/domain/campuses";
import { importCampusSnapshot, listCampuses } from "@/src/services/campus-service";
import { myProfile, updateProfile } from "@/src/services/profile-service";
import snapshot from "../data/campuses/indonesia.json";
import source from "../data/campuses/source.json";
import { campusId, resetDatabase, testDatabase, user } from "./helpers/database";

let db: Database, close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await testDatabase());
});
afterAll(async () => close?.());
beforeEach(async () => resetDatabase(db));

const importSnapshot = (raw: unknown = snapshot) =>
  db.transaction((tx) => importCampusSnapshot(tx, raw));

describe("Referensi kampus Indonesia", () => {
  it("mengimpor snapshot tanpa duplikasi dan mempertahankan kampus pengguna lama", async () => {
    const actor = await user(db);
    expect(await importSnapshot()).toBe(source.count);
    const before = await listCampuses(db);
    expect(before).toHaveLength(197);
    await importSnapshot();
    expect(await listCampuses(db)).toEqual(before);
    expect(new Set(before.map((campus) => campus.id)).size).toBe(source.count);
    expect(before.some((campus) => campus.name === "Kampus Surabaya")).toBe(false);
    const [saved] = await db.select().from(users).where(eq(users.id, actor.id));
    expect(saved.campusId).toBe(campusId);
    expect((await myProfile(db, saved)).campus).toMatchObject({
      id: campusId,
      name: "Kampus Surabaya",
      isActive: false,
    });
  });

  it("mencari nama, singkatan dari domain, dan beberapa kata tanpa membedakan kapital", async () => {
    await importSnapshot();
    expect((await listCampuses(db, "  ITS  "))[0]).toMatchObject({
      name: "Institut Teknologi Sepuluh Nopember",
    });
    expect(await listCampuses(db, "teknologi bandung")).toEqual([
      expect.objectContaining({ name: "Institut Teknologi Bandung" }),
    ]);
    expect(await listCampuses(db, "kampus-tidak-ada")).toEqual([]);
    expect(await listCampuses(db, "%")).toEqual([]);
    await expect(listCampuses(db, "a".repeat(101))).rejects.toThrow();
  });

  it("memperbarui nama dan domain tanpa mengganti ID atau membuka kampus yang diarsipkan", async () => {
    const row = snapshot[0];
    await importSnapshot([row]);
    const [before] = await listCampuses(db);
    await db.update(campuses).set({ isActive: false }).where(eq(campuses.id, before.id));
    await importSnapshot([
      { ...row, name: "Nama Kampus Baru", domains: [...row.domains, "baru.ac.id"] },
    ]);
    const [saved] = await db.select().from(campuses).where(eq(campuses.id, before.id));
    expect(saved).toMatchObject({
      id: before.id,
      name: "Nama Kampus Baru",
      isActive: false,
      domains: [...row.domains, "baru.ac.id"],
    });
    expect(await listCampuses(db)).toEqual([]);
  });

  it("hanya mengimpor Indonesia dan menolak snapshot kosong, rusak, atau domain ganda", async () => {
    const row = snapshot[0];
    await importSnapshot([row, { ...row, country: "Singapore", alpha_two_code: "SG" }]);
    expect(await listCampuses(db)).toHaveLength(1);
    await expect(importSnapshot([])).rejects.toThrow();
    await expect(importSnapshot([{ ...row, domains: [] }])).rejects.toThrow();
    await expect(importSnapshot([row, { ...row, name: "Duplikat" }])).rejects.toThrow(/duplikat/);
    expect(await listCampuses(db)).toHaveLength(1);
  });

  it("menyimpan pilihan lintas kampus dan menolak UUID yang bukan kampus tersedia", async () => {
    const actor = await user(db, { campusId: null });
    await importSnapshot();
    const [its] = await listCampuses(db, "its");
    const [ugm] = await listCampuses(db, "ugm");
    const first = await updateProfile(db, actor, { name: actor.name, campusId: its.id });
    expect(first.campus?.id).toBe(its.id);
    const second = await updateProfile(db, actor, { name: actor.name, campusId: ugm.id });
    expect(second.campus?.id).toBe(ugm.id);
    await expect(updateProfile(db, actor, { name: actor.name, campusId })).rejects.toMatchObject({
      code: "INVALID_CAMPUS",
    });
    await expect(
      updateProfile(db, actor, { name: actor.name, campusId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "INVALID_CAMPUS" });
    const [saved] = await db.select().from(users).where(eq(users.id, actor.id));
    expect(saved.campusId).toBe(ugm.id);
  });

  it("mengizinkan profil lama mempertahankan kampus yang diarsipkan", async () => {
    const actor = await user(db);
    await importSnapshot();
    const result = await updateProfile(db, actor, { name: actor.name, campusId });
    expect(result.user.campusId).toBe(campusId);
    expect(result.campus?.isActive).toBe(false);
  });

  it("pencarian UI mendukung aksen dan tetap memakai objek kampus asli", () => {
    const rows = [{ name: "Université Test", domains: ["test.ac.id"] }];
    expect(filterCampuses(rows, "universite TEST")).toEqual(rows);
    expect(filterCampuses(rows, "")[0]).toBe(rows[0]);
  });
});
