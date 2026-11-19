import { neon } from "@neondatabase/serverless"
import { readFileSync } from "fs"
const env = Object.fromEntries(readFileSync(".env","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}))
const sql = neon(env.DATABASE_URL)
const ORG='Fv60xcVOVV7FefxnF4jL7HFgjEiqNitZ'
console.log(await sql`select status, bound_at, last_seen_at from telegram_binding where organization_id=${ORG}`)
const cols = await sql`select column_name from information_schema.columns where table_name='telegram_out_message'`
console.log(cols.map(c=>c.column_name).join(","))
