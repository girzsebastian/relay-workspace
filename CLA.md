# Relay Contributor Terms

Thank you for contributing to Relay.

**You do not have to sign anything, and nothing here blocks your pull request.**
Opening one is how you accept these terms — see [How you accept](#how-you-accept)
at the end.

This agreement is adapted from the [Apache Software Foundation Individual
Contributor License Agreement v2.0](https://www.apache.org/licenses/icla.pdf),
which is the most widely used agreement of its kind. The one substantive
addition is the explicit relicensing permission in section 2, explained under
**Why this exists** below.

You keep the copyright to everything you write. This grants a licence; it does
not transfer ownership.

## Why this exists

Relay is licensed under the **GNU Affero General Public License v3.0 or later**,
and the desktop application will stay free and open under it. The AGPL is a
deliberate choice: anyone may use, modify, self-host and fork Relay, but a
modified version offered to other people over a network has to publish its
source. That is what keeps this from becoming someone else's closed hosted
product.

The same clause would also bind the maintainer, and there are things a hosted
Relay may one day need to do — run agents on rented machines, hold a team's
sessions, sell that as a service — that are hard to build under a licence
nobody may deviate from. Offering the work under other terms as well requires
permission from **every** copyright holder in the codebase.

Without an agreement like this one, a project with twenty contributors cannot
change its licensing at all: it would need twenty signatures years later, and a
single unreachable person blocks it permanently.

Signing now keeps that door open. It does not commit the project to walking
through it, and **nothing you contribute can be taken out of the AGPL-licensed
version** — what is already public stays public under the AGPL, permanently.

## Copyright in the existing code

Every commit in this repository before the first signed contribution is the work
of the maintainer, **Girz Sebastian** ([@girzsebastian](https://github.com/girzsebastian)),
who is therefore the sole copyright holder of the pre-existing work.

Two git identities appear in the history and both are his:

| Name in git      | Email                                    |
| ---------------- | ---------------------------------------- |
| `girzsebastian`  | `girzsebastian@users.noreply.github.com` |
| `Girz Sebastian` | `girzsebastian@Girzs-MacBook-Pro.local`  |

The second is a locally-derived address that GitHub does not attribute to an
account, so it is recorded here explicitly rather than left to be inferred.

Some commits carry a `Co-Authored-By` trailer naming an AI assistant. Those
trailers record how the work was produced. They do not name a copyright holder,
and no assistant claims or can hold copyright in the output.

Commits by `dependabot[bot]` change dependency version strings and carry no
authorship.

## Agreement

By signing, you accept the terms below for your past and future contributions to
Relay.

### 1. Definitions

**"You"** means the individual who signs this agreement, or the legal entity on
whose behalf it is signed.

**"Contribution"** means any original work of authorship, including any changes
or additions to existing work, that you intentionally submit to Relay. "Submit"
means any form of communication sent to the project or its maintainers,
including pull requests, patches, and issue comments containing code, but
excluding anything you clearly mark **"Not a Contribution."**

**"Project"** means the Relay repository at
https://github.com/girzsebastian/relay-workspace and its maintainer.

### 2. Copyright licence

You grant the Project a perpetual, worldwide, non-exclusive, no-charge,
royalty-free, irrevocable copyright licence to reproduce, prepare derivative
works of, publicly display, publicly perform, sublicense, and distribute your
Contributions and such derivative works.

This licence expressly includes the right to distribute your Contributions
**under licence terms other than the GNU Affero General Public License**,
including proprietary terms, whether alone or as part of a larger work.

You retain all right, title, and interest in your Contributions. This is a
licence, not an assignment.

### 3. Patent licence

You grant the Project a perpetual, worldwide, non-exclusive, no-charge,
royalty-free, irrevocable patent licence to make, have made, use, offer to sell,
sell, import, and otherwise transfer your Contributions, where such licence
applies only to those patent claims licensable by you that are necessarily
infringed by your Contributions alone or by combination of your Contributions
with the Project.

If any entity institutes patent litigation alleging that a Contribution
constitutes direct or contributory patent infringement, any patent licences
granted under this agreement for that Contribution terminate as of the date such
litigation is filed.

### 4. You have the right to grant this

You represent that each Contribution is your original creation, and that you are
legally entitled to grant the above licences.

If your employer has rights to intellectual property you create — which is
common in employment contracts — you represent that you have received permission
to make the Contribution on their behalf, or that your employer has waived those
rights, or that your employer has signed this agreement.

### 5. Third-party work

If you submit work that is not your original creation, you must submit it
separately from your Contributions, identify its source and the licence or other
restriction it carries, and mark it clearly as **"Submitted on behalf of a
third party: [named here]."**

Code produced with an AI assistant is your Contribution and your
responsibility: by submitting it you represent that you may license it under
this agreement, the same as anything you typed yourself.

### 6. No warranty

Except as stated above, your Contributions are provided **"as is"**, without
warranty of any kind, express or implied.

### 7. Telling us when something changes

You agree to notify the Project if you become aware that any statement in this
agreement is or becomes inaccurate.

## How you accept

**By opening a pull request against this repository, you accept these terms for
that contribution and every contribution you have already made.**

There is no bot, no signature file, and no check standing between your work and a
review. A pull request from a fork is treated exactly like one from a branch
here. If you would rather not accept these terms, say so in the pull request and
it will be discussed there rather than closed by a robot.

The pull request template repeats this so nobody accepts it without seeing it.

---

_This document is a legal agreement adapted from a standard template. It has not
been reviewed by a lawyer on behalf of this project. If you are contributing on
behalf of an employer, have your legal team read it first._
