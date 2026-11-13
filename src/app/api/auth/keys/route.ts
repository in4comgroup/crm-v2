import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import {
  createApiKey,
  deleteApiKeys,
  getAllApiKeys,
  getApiKeys,
} from "@/server/api-keys"

// Sign-in required for every method (the helpers return null without a
// session, which used to surface as an empty 200/201).
async function unauthorized(): Promise<NextResponse | null> {
  const session = await getServerSession()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return null
}

export async function GET(request: NextRequest) {
  const denied = await unauthorized()
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const keyId = searchParams.get("keyId")

  try {
    if (keyId) {
      const result = await getApiKeys(keyId)

      if (result?.error) {
        return NextResponse.json({ error: "Unknown error" }, { status: 500 })
      }

      return NextResponse.json({ data: result?.data })
    } else {
      const result = await getAllApiKeys()

      if (result?.error) {
        return NextResponse.json({ error: "Unknown error" }, { status: 500 })
      }

      // console.log("GET /api/auth/keys result:", result)

      return NextResponse.json({ data: result?.data })
    }
  } catch (error) {
    console.error("Error in GET /api/auth/keys:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const denied = await unauthorized()
  if (denied) return denied

  try {
    const body = await request.json()
    const { name, expiresIn, prefix, description } = body

    if (!name || !expiresIn || !prefix || !description) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const result = await createApiKey({ name, expiresIn, prefix, description })

    if (result?.error) {
      return NextResponse.json({ error: "Unknown error" }, { status: 500 })
    }

    return NextResponse.json({ data: result?.data }, { status: 201 })
  } catch (error) {
    console.error("Error in POST /api/auth/keys:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await unauthorized()
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const keyId = searchParams.get("keyId")

  if (!keyId) {
    return NextResponse.json({ error: "keyId is required" }, { status: 400 })
  }

  try {
    const result = await deleteApiKeys(keyId)

    if (result?.error) {
      return NextResponse.json({ error: "Unknown error" }, { status: 500 })
    }

    return NextResponse.json({ data: result?.data })
  } catch (error) {
    console.error("Error in DELETE /api/auth/keys:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
