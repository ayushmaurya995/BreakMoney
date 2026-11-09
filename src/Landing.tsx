import { ArrowRight, ArrowUpRight, Check, CircleDollarSign, ReceiptText, ShieldCheck, Sparkles, Users, Wallet } from 'lucide-react';

type Props = { onGetStarted: () => void; onSignIn: () => void };

const features = [
  { icon: Users, title: 'One space for your people', copy: 'Create groups for trips, roommates, dinners and everyday shared plans.' },
  { icon: ReceiptText, title: 'Expenses without the maths', copy: 'Record bills, split equally or enter custom shares, and keep a clear activity trail.' },
  { icon: Wallet, title: 'A shared vault overview', copy: 'Track recorded contributions, expenses and the group balance in one place.' },
];

export default function Landing({ onGetStarted, onSignIn }: Props) {
  return <main className="landing">
    <nav className="landing-nav">
      <a className="landing-brand" href="#"><b>B</b><span>break <em>money</em></span></a>
      <div className="landing-links"><a href="#features">Features</a><a href="#how-it-works">How it works</a></div>
      <div className="landing-nav-actions"><button className="landing-signin" onClick={onSignIn}>Sign in</button><button className="landing-cta small" onClick={onGetStarted}>Get started <ArrowUpRight size={16}/></button></div>
    </nav>

    <section className="landing-hero">
      <div className="landing-copy">
        <span className="landing-kicker"><Sparkles size={14}/> SHARED MONEY, SIMPLIFIED</span>
        <h1>Good times together.<br/><span>Money, made clear.</span></h1>
        <p>Bring group expenses, shared contributions and settlements into one beautifully simple space. Less awkward maths, more time together.</p>
        <div className="landing-actions"><button className="landing-cta" onClick={onGetStarted}>Create your free account <ArrowRight size={18}/></button><button className="landing-secondary" onClick={onSignIn}>I already have an account</button></div>
        <div className="landing-trust"><span><Check size={14}/> Clear expense tracking</span><span><ShieldCheck size={14}/> Secure sign-in</span></div>
      </div>
      <div className="landing-visual" aria-label="BreakMoney shared expense dashboard preview">
        <div className="visual-orb orb-one"></div><div className="visual-orb orb-two"></div>
        <div className="visual-card visual-main">
          <div className="visual-top"><span className="visual-mark">B</span><span>GROUP OVERVIEW</span><span className="visual-dot"></span></div>
          <p className="visual-muted">Weekend in Goa</p><h2>₹ 12,450</h2><span className="visual-caption">Recorded group activity</span>
          <div className="visual-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
          <div className="visual-bottom"><span><b>4 members</b><small>Sharing together</small></span><span className="avatar-stack"><i>A</i><i>R</i><i>S</i><i>+</i></span></div>
        </div>
        <div className="visual-float float-expense"><span className="float-icon"><ReceiptText size={18}/></span><span><b>Cab & dinner</b><small>Expense added</small></span><strong>₹ 1,850</strong></div>
        <div className="visual-float float-settle"><span className="settle-check"><Check size={17}/></span><span><b>Split made simple</b><small>Everyone stays in sync</small></span></div>
      </div>
    </section>

    <section className="landing-strip"><span>MADE FOR SHARING</span><b>Roommates</b><i></i><b>Trips</b><i></i><b>Friends</b><i></i><b>Everyday expenses</b></section>

    <section className="landing-features" id="features">
      <div className="landing-section-heading"><span className="landing-kicker">A CALMER WAY TO MANAGE MONEY</span><h2>Everything shared.<br/><em>Nothing confusing.</em></h2><p>Simple tools to keep every group on the same page.</p></div>
      <div className="landing-feature-grid">{features.map(({icon:Icon,title,copy},i)=><article className="landing-feature" key={title}><span className="feature-icon"><Icon size={21}/></span><small>0{i+1}</small><h3>{title}</h3><p>{copy}</p></article>)}</div>
    </section>

    <section className="landing-how" id="how-it-works"><div><span className="landing-kicker">UP AND RUNNING IN MINUTES</span><h2>From “who paid?”<br/><em>to all sorted.</em></h2></div><div className="landing-steps"><article><b>01</b><span><strong>Create a group</strong><small>Start a space and invite your people with a link.</small></span></article><article><b>02</b><span><strong>Add shared expenses</strong><small>Record a bill and choose equal or custom splits.</small></span></article><article><b>03</b><span><strong>See who owes whom</strong><small>Review the ledger and suggested settlements clearly.</small></span></article></div></section>

    <section className="landing-final"><span className="landing-kicker">MAKE SHARED MONEY FEEL SIMPLE</span><h2>More together.<br/><em>Less to figure out.</em></h2><button className="landing-cta" onClick={onGetStarted}>Get started with BreakMoney <ArrowUpRight size={18}/></button></section>
    <footer className="landing-footer"><a className="landing-brand" href="#"><b>B</b><span>break <em>money</em></span></a><span>BreakMoney · Shared money, without the mess.</span><small>Balances are records of group activity, not a bank account or stored-value wallet.</small></footer>
  </main>;
}
