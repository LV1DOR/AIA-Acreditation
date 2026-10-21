export function invitationMessage(result:string,locale:"pt"|"en") {
  const messages={
    privacy_configuration_required:{pt:"Publique o aviso de privacidade do evento em Privacidade antes de enviar convites.",en:"Publish this event's shared privacy notice in Privacy before sending invitations."},
    retention_policy_required:{pt:"Registe as datas de conservação do evento em Privacidade antes de enviar convites.",en:"Record this event's retention dates in Privacy before sending invitations."},
    invitation_pending:{pt:"Já existe um convite válido para este endereço. Não foi enviado outro.",en:"A valid invitation already exists for this address. No additional email was sent."},
    invitation_queued:{pt:"Convite agendado para envio.",en:"Invitation queued for delivery."},
  } as const;
  return messages[result as keyof typeof messages]?.[locale];
}
