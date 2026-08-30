import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const dir = path.join(process.cwd(),"cloudflare","migrations");
  const names = (await readdir(dir)).filter(name=>/^\d+_.*\.sql$/.test(name)).sort();
  const items = await Promise.all(names.map(async name=>{const sql=await readFile(path.join(dir,name),"utf8");return{name,sql,checksum:createHash("sha256").update(sql).digest("hex")};}));
  return NextResponse.json({version:"0.20.35",schemaVersion:"2.21.0",items},{headers:{"cache-control":"no-store"}});
}
