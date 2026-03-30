import Card, { CardHeader } from '../../components/ui/Card'

export default function PlaceholderPage({ title, description }) {
  return (
    <div className="feature-page placeholder-page">
      <Card>
        <CardHeader title={title} subtitle="Módulo em preparação" />
        <p className="feature-subtitle">{description}</p>
      </Card>
    </div>
  )
}
