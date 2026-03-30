import { useMemo, useState } from 'react'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'

export default function CommunicationPage() {
  const [phone, setPhone] = useState('')
  const [time, setTime] = useState('08:00')
  const [message, setMessage] = useState('Bom dia, professor(a)! Lembrete da aula da EBD de hoje. Por favor, preencha e envie a caderneta mensal após a classe. Deus abençoe!')

  const encodedMessage = useMemo(() => encodeURIComponent(message), [message])
  const cleanPhone = useMemo(() => phone.replace(/\D/g, ''), [phone])
  const whatsappUrl = cleanPhone
    ? `https://wa.me/55${cleanPhone}?text=${encodedMessage}`
    : `https://wa.me/?text=${encodedMessage}`

  async function copyMessage() {
    await navigator.clipboard.writeText(message)
    window.alert('Mensagem copiada para a area de transferencia.')
  }

  function openWhatsapp() {
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer')
  }

  function callTeacher() {
    if (!cleanPhone) {
      window.alert('Informe um telefone para ligar.')
      return
    }
    window.open(`tel:${cleanPhone}`)
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <div>
          <h2 className="feature-title">Comunicação</h2>
          <p className="feature-subtitle">Base rápida para lembretes da superintendência</p>
        </div>
      </div>

      <Card>
        <CardHeader title="Lembrete padrão" subtitle="Edite o texto antes de enviar" />
        <div className="inline-form">
          <label htmlFor="comm-time">Horário do lembrete</label>
          <input
            id="comm-time"
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />

          <label htmlFor="comm-phone">Telefone do professor</label>
          <input
            id="comm-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="(00) 00000-0000"
          />

          <label htmlFor="comm-message">Mensagem</label>
          <textarea
            id="comm-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />

          <p className="feature-subtitle">Horário configurado: {time}</p>

          <div className="feature-actions">
            <Button onClick={openWhatsapp}>Abrir WhatsApp</Button>
            <Button variant="secondary" onClick={copyMessage}>Copiar mensagem</Button>
            <Button variant="ghost" onClick={callTeacher}>Ligar para professor</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
