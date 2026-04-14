import { Resend } from 'resend'

function getResendApiKey() {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set')
  }

  return apiKey
}

function getInvitationFromAddress() {
  const fromAddress = process.env.RESEND_FROM_EMAIL

  if (!fromAddress) {
    throw new Error('RESEND_FROM_EMAIL is not set')
  }

  return fromAddress
}

function buildInvitationEmail(input: {
  organizationName: string
  inviterName: string
  inviteeEmail: string
  role: 'admin' | 'user'
}) {
  const subject = `Invitation to join ${input.organizationName}`
  const text = [
    `You have been invited to join ${input.organizationName}.`,
    '',
    `Invited by: ${input.inviterName}`,
    `Email: ${input.inviteeEmail}`,
    `Role: ${input.role}`,
    '',
    'You can sign in to the application and accept the invitation from there.',
  ].join('\n')

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; line-height: 1.5; color: #0f172a;">
      <h1 style="font-size: 20px; margin-bottom: 16px;">You are invited to join ${input.organizationName}</h1>
      <p style="margin: 0 0 12px;">${input.inviterName} invited <strong>${input.inviteeEmail}</strong> to join <strong>${input.organizationName}</strong>.</p>
      <p style="margin: 0 0 12px;">Role: <strong>${input.role}</strong></p>
      <p style="margin: 0;">Sign in to the application and accept the invitation from there.</p>
    </div>
  `.trim()

  return { subject, text, html }
}

export async function sendInvitationEmail(input: {
  organizationName: string
  inviterName: string
  inviteeEmail: string
  role: 'admin' | 'user'
}) {
  const resend = new Resend(getResendApiKey())
  const email = buildInvitationEmail(input)

  const result = await resend.emails.send({
    from: getInvitationFromAddress(),
    to: input.inviteeEmail,
    subject: email.subject,
    text: email.text,
    html: email.html,
  })

  if (result.error) {
    throw new Error(result.error.message)
  }

  return result.data
}
