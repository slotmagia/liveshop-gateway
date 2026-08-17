import { useState, type FormEvent } from 'react'
import { Loader2, ShieldCheck, Store } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Input, Label } from '../ui/input'
import { login, type AuthenticatedConsoleHostConfig, type Session } from '../runtime'

/**
 * The pre-authentication screen. It is the only console view that runs before
 * the registry answers, so it deliberately depends on nothing but the auth
 * endpoints.
 */
export function LoginPage({ config, onAuthenticated }: {
  config: AuthenticatedConsoleHostConfig
  onAuthenticated(session: Session): void
}) {
  const merchant = config.realm === 'MERCHANT'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      onAuthenticated(await login(config, {
        username,
        password,
      }))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-soft to-background p-6">
      <Card className="w-full max-w-md shadow-pop">
        <CardHeader className="space-y-2 text-center">
          <div className="flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              {merchant ? <Store className="h-6 w-6 text-primary" /> : <ShieldCheck className="h-6 w-6 text-primary" />}
            </div>
          </div>
          <CardTitle className="text-2xl">{merchant ? 'LiveShop 商户后台' : 'LiveShop 总后台'}</CardTitle>
          <CardDescription>{merchant ? '登录商户运营控制台' : '登录平台管理控制台'}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ls-username">账号</Label>
              <Input
                id="ls-username"
                autoComplete="username"
                required
                placeholder={merchant ? '商户账号' : '平台账号'}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ls-password">密码</Label>
              <Input
                id="ls-password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="输入密码"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <p className="min-h-5 text-sm text-danger" role="alert">{error}</p>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? '登录中…' : '登录'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
