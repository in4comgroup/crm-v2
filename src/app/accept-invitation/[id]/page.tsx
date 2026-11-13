import { getInvitationForAcceptance } from "@/server/invitations"
import { AcceptInvitationContent } from "./accept-invitation-content"

// Deliberately OUTSIDE the (auth) route group: (auth)/layout.tsx redirects
// every signed-in user to /dashboard, which would hide the "Accept invitation"
// and "Wrong account" branches from users who are already signed in.
export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const invitation = await getInvitationForAcceptance(id)
  return <AcceptInvitationContent initialInvitation={invitation} />
}
