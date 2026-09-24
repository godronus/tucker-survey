Build me a production-ready survey web app for Gcore’s ISP / peering / embedded-cache partner program, deployed on Gcore FastEdge.
The goal is to collect structured feedback from ISPs, IXPs, peering engineers, network operators, and embedded-cache partners about what they want from a self-service peering/cache-partner portal.
The visual design should match the Gcore peering-portal mockups from this conversation: light gray background, white cards, black/dark text, Gcore orange accents, clean network-operator aesthetic. The survey UI is a prototype, not the final production portal.
Start by researching the current FastEdge runtime/deployment model and choose the most idiomatic architecture. Then build the full project, not snippets.
Product requirements
Make the survey anonymous by default. Name, company, ASN, and email should be optional. Target completion time: roughly 5–8 minutes.
Use conditional branching so cache-specific questions only appear to respondents who actually operate embedded caches.
Use prioritization heavily. Avoid endless “check everything you like” questions. For feature sets, ask people to choose their top 3 or top 5.
Include a progress indicator, inline validation, mobile responsiveness, accessible controls, and browser autosave/local persistence so an accidental refresh doesn’t destroy the response.
Survey structure
1. About the respondent
Ask for:
- Role: Peering/Interconnection, Network Engineering, Network Architecture, Capacity Planning, NOC/Operations, CDN/Cache Operations, IXP, Engineering Leadership, Other
- Network type: ISP/Broadband, Mobile, Regional ISP, National/Tier-1, Hosting/Cloud, Enterprise, IXP, Content Network, Other
- Optional organization
- Optional ASN
2. Experience with other content-provider portals
Ask which they have used:
- Google / GGC
- Netflix Open Connect
- Meta
- Cloudflare
- Akamai
- AWS / CloudFront ePoP
- Microsoft
- Apple
- Other
- None
Then free-text:
- Which provider offers the best operator experience, and why?
- What do existing portals do especially well?
- What still requires an email or ticket that should obviously be self-service?
3. Gcore portal priorities
Ask them to choose their top 5 from:
- Current traffic with Gcore
- 30/90/365-day traffic history
- Traffic by market / PoP / DC
- Traffic by PNI / IX / transit
- P95 / peak / growth trends
- Interface utilization / headroom
- Capacity exhaustion forecasting
- Public BGP session state
- Private / PNI session state
- Received prefixes
- Advertised prefixes
- Separate IPv4 / IPv6 state
- BGP flap history
- IRR validation
- RPKI validation
- Reason a prefix was filtered/rejected
- Communities
- Shared-IX discovery
- One-click peering requests
- PNI eligibility
- PNI upgrade / augmentation requests
- Peering request lifecycle tracking
- Maintenance visibility
- Incident visibility
- Looking glass / diagnostics
- API
- Webhooks
- Prometheus/OpenMetrics
- CSV/JSON export
Then ask: “What are we missing?”
4. Peering workflow
Ask which actions should be self-service:
- Detect IXs where both networks are present
- Request IPv4 + IPv6 sessions
- Exchange addressing automatically
- Verify PeeringDB information
- Choose bilateral vs route-server peering
- Track approval
- Track configuration
- See when BGP becomes established
- See received/advertised prefixes
- Download example Junos / IOS-XR / EOS snippets
- Open an issue against a specific session
- Request additional locations
- Request IX → PNI migration
Ask whether this lifecycle is useful:
Available → Requested → Approved → Configured → BGP Established → Passing Traffic
Include a free-text field if they would structure it differently.
5. Routing transparency
Use a matrix with:
- Not useful
- Nice to have
- Important
- Extremely important
Rows:
- Prefixes Gcore receives from my ASN
- Prefixes accepted
- Prefixes rejected
- Reason a prefix was rejected
- IRR state
- RPKI state
- Communities received
- BGP flap history
- Where Gcore learns my routes
- Which Gcore PoP serves a prefix
- Why a prefix is not served locally
- Connectivity testing from Gcore edge locations toward my network
Then ask:
“What routing problem do you most often need a content provider’s peering team to investigate manually?”
6. Embedded cache experience
Ask first:
“Do you currently operate embedded caches for one or more content providers?”
If no, skip the cache-specific operational questions.
If yes, ask respondents to choose their top 5 friction points:
- Eligibility / qualification
- Commercial terms
- Technical requirements
- Site qualification
- Capacity sizing
- Shipping
- Customs / import duty
- Rack requirements
- Power requirements
- Cabling / optics
- IP addressing
- BGP configuration
- Installation
- Initial turn-up
- Troubleshooting
- Monitoring
- Capacity augmentation
- Hardware failure / RMA
- Hardware refresh
- Relocation
- Decommissioning
- Support / escalation
Then ask what Gcore should show before someone requests a cache:
- Eligible measured traffic
- Traffic by city / region
- Historical traffic growth
- Estimated traffic offload
- Recommended deployment size
- Rack requirement
- Power requirement
- Port / optic requirement
- Expected fill traffic
- Expected cache egress
- Whether the network currently qualifies
- Why it qualifies / doesn’t qualify
- What would need to change before it qualifies
7. Operating an installed cache
Ask users to choose their top 5 telemetry items:
- Cache traffic
- Cache-hit / offload ratio
- Traffic by node
- Traffic by prefix
- Traffic by service/content category
- Fill traffic
- NIC/interface utilization
- Server health
- Disk health
- Hardware alarms
- Serving capacity
- Remaining headroom
- Capacity forecast
- BGP state
- Served prefixes
- Planned maintenance
- Software/version state
- Incident history
Ask which actions should be self-service:
- Change serving prefixes
- Change BGP configuration
- Add/remove prefixes
- Request additional capacity
- Request additional appliances
- Request relocation
- Request RMA
- Schedule maintenance
- Download diagnostics
- Open support case
- Decommission appliance
- Update site/NOC contacts
8. Alerts and automation
Ask what Gcore should proactively alert on:
- Peering session down
- Session flapping
- Unexpected traffic reduction
- Unexpected traffic shift
- High PNI utilization
- Approaching capacity limit
- Cache hardware fault
- Cache capacity exhaustion
- Prefix rejected
- RPKI/IRR issue
- Planned maintenance
- Active incident
- Cache augmentation recommended
Ask preferred notification channels:
- Email
- Portal
- Webhook
- Slack
- Microsoft Teams
- PagerDuty
- API polling
- Other
Ask:
“Would you use an API for this portal?”
If yes/maybe, ask:
“What would you automate with it?”
9. Forced-priority questions
These are some of the most important questions in the survey:
- If Gcore could build only THREE things next, what should they be?
- What is the single most frustrating interaction you currently have with a large content provider?
- What is one feature from another provider that you wish every provider offered?
- What is something NO provider currently does that you wish existed?
10. Optional follow-up
Ask whether they would be willing to:
- Review future prototypes
- Join a 20–30 minute feedback call
If yes, optionally collect:
- Name
- Work email
- Organization
- ASN
Intro copy
Use something close to:
“We’re redesigning how ISPs and network operators interact with Gcore for peering, traffic visibility, embedded caches, capacity planning and ongoing operations.
We’ve built an early self-service portal prototype, but before we go much further we want input from people who regularly work with content providers.
We’re especially interested in what existing provider portals do well, what they do poorly, and what still requires unnecessary email or ticket back-and-forth.
Responses can be anonymous. Contact information is optional.”
Final copy
“Thanks. We’re building this for the people who actually have to operate the network, so critical feedback is more useful to us than polite feedback.”
Technical requirements
- Build for Gcore FastEdge
- Full source project
- Clean folder structure
- README
- Local development instructions
- FastEdge deployment instructions
- Environment-variable documentation
- Submission API
- Input validation
- Basic abuse/spam protection without CAPTCHA if possible
- Structured response schema
- Durable response storage
- If FastEdge is not appropriate for durable state, choose a sensible backend/database and clearly separate it from the FastEdge frontend/API layer
- Make data export straightforward
- Ideally include a minimal protected admin/export route, or at least a CLI/script for exporting responses to CSV/JSON
- Do not use Google Forms, Typeform, or another SaaS survey platform
- Do not overengineer authentication; respondents should not need an account
Before coding, inspect the current FastEdge docs/runtime and make an explicit architecture choice.
Then implement it end-to-end, run it locally, test the form branching and submission flow, and leave me with something I can actually deploy.