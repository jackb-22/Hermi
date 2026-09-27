import AuthenticationServices
import SwiftUI

struct ConnectionSheet: View {
  @EnvironmentObject var store: CairnStore
  @State var address = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 22) {
      SectionLabel(text: "Development connection")
      Text("Bring your world in.").font(.system(size: 28, weight: .bold, design: .rounded))
      Text(
        "Connect to the Cairn API to sign in and use real places, plans, and check-ins. The preview's sample data stays separate."
      ).font(.subheadline).foregroundStyle(Theme.muted)
      TextField("https://your-cairn-api.example", text: $address).textFieldStyle(.roundedBorder)
        .autocorrectionDisabled()
      MainButton(title: "Connect & sign in") {
        store.run {
          let cleaned = address.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(
            in: CharacterSet(charactersIn: "/"))
          store.baseAddress = cleaned
          let api = try store.api
          _ = try await api.request("onboarding/deck")
          UserDefaults.standard.set(cleaned, forKey: "cairn.api")
          store.preview = false
          store.signedIn = false
          store.me = .null
          store.profile = .null
          store.places = []
          store.plan = .null
          store.feed = .null
          store.sheet = nil
        }
      }.disabled(address.isEmpty)
      Text("Use the API origin without /v1. HTTPS is required except for localhost development.")
        .font(.caption).foregroundStyle(Theme.muted)
    }.onAppear { address = store.baseAddress }
  }
}
struct OnboardingView: View {
  @EnvironmentObject var store: CairnStore
  @State var step = 0
  @State var deck: [JSON] = []
  @State var swipes: [JSON] = []
  @State var cardIndex = 0
  @State var is21 = false
  @State var email = ""
  @State var year = 2027
  @State var code = ""
  @State var sent = false
  @State var name = ""
  @State var username = ""
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 26) {
        HStack {
          Text("cairn").font(.system(size: 30, weight: .heavy, design: .rounded))
          Spacer()
          Button {
            store.sheet = "connection"
          } label: {
            Image(systemName: "network")
          }.buttonStyle(.plain).accessibilityLabel("API connection")
        }.padding(.top, 35)
        HStack(spacing: 6) {
          ForEach(0..<4, id: \.self) { i in
            Capsule().fill(i <= step ? Theme.green : Theme.line).frame(height: 4)
          }
        }
        if step == 0 {
          CairnStack(score: 250).frame(height: 220).padding(.horizontal, 90)
          SectionLabel(text: "Make a little room for outside")
          Text("It only counts\nif you go.").font(
            .system(size: 43, weight: .bold, design: .rounded)
          ).tracking(-1)
          Text("Find a place. Bring a friend. Stack up the days you actually lived.").font(.title3)
            .foregroundStyle(Theme.muted)
          MainButton(title: "Find your kind of outside") {
            step = 1
            Task { await loadDeck() }
          }
        } else if step == 1 {
          Text("Your kind of day.").font(.system(size: 32, weight: .bold, design: .rounded))
          Toggle("I'm 21 or older", isOn: $is21).font(.subheadline).onChange(of: is21) { _, _ in
            cardIndex = 0
            swipes = []
          }
          let cards = deck.filter { is21 || !$0["requires21"].flag }
          if cardIndex < cards.count {
            let card = cards[cardIndex]
            VStack(spacing: 24) {
              CategoryBadge(category: card["category"].text, size: 100)
              Text(card["title"].text).font(.system(size: 29, weight: .bold, design: .rounded))
              Text("\(cardIndex+1) of \(cards.count)").font(.caption).foregroundStyle(Theme.muted)
            }.frame(maxWidth: .infinity).padding(.vertical, 45).background(
              Theme.lime.opacity(0.25), in: RoundedRectangle(cornerRadius: 28))
            HStack {
              SmallButton(title: "Not for me", icon: "xmark") { choose(card, false, cards.count) }
              Spacer()
              SmallButton(title: "Into it", icon: "checkmark") { choose(card, true, cards.count) }
            }
          } else if deck.isEmpty {
            EmptyCard(
              title: "Connect to get started", message: "Your taste cards come from the Cairn API.")
            MainButton(title: "Set up connection", icon: "network") { store.sheet = "connection" }
          } else {
            MainButton(title: "Continue") { step = 2 }
          }
        } else if step == 2 {
          Text("A real you.\nA real community.").font(
            .system(size: 32, weight: .bold, design: .rounded))
          if !store.signedIn {
            SignInWithAppleButton(
              .signIn, onRequest: { $0.requestedScopes = [.fullName] },
              onCompletion: { result in
                store.run {
                  let auth = try result.get()
                  guard let credential = auth.credential as? ASAuthorizationAppleIDCredential,
                    let data = credential.identityToken,
                    let token = String(data: data, encoding: .utf8)
                  else {
                    throw APIError(code: "APPLE", message: "Apple didn't return a sign-in token.")
                  }
                  let fullName =
                    credential.fullName.map { PersonNameComponentsFormatter().string(from: $0) }
                    ?? ""
                  try await store.authenticate(token, fullName)
                  if !swipes.isEmpty {
                    let r = try await store.call(
                      "me/taste", "POST", ["is21": .bool(is21), "swipes": .array(swipes)])
                    store.me = r["user"]
                  }
                  name = fullName
                }
              }
            ).signInWithAppleButtonStyle(.black).frame(height: 50)
          } else {
            Text("Verify your school email to join the student community.").font(.subheadline)
              .foregroundStyle(Theme.muted)
            TextField("you@school.edu", text: $email).textFieldStyle(.roundedBorder)
              .autocorrectionDisabled()
            Stepper("Graduation year: \(year)", value: $year, in: 2000...2040)
            if sent {
              TextField("6-digit code", text: $code).textFieldStyle(.roundedBorder)
              MainButton(title: "Verify email") {
                store.run {
                  let r = try await store.call("auth/edu/verify", "POST", ["code": .string(code)])
                  store.me = r
                  step = 3
                }
              }.disabled(code.count != 6)
            } else {
              MainButton(title: "Send a code", icon: "envelope") {
                store.run {
                  _ = try await store.call(
                    "auth/edu", "POST",
                    ["email": .string(email), "gradYear": .number(Double(year))])
                  sent = true
                }
              }
            }
            Button("I'll verify later") { step = 3 }.font(.subheadline)
          }
        } else {
          Text("Make yourself\nat home.").font(.system(size: 32, weight: .bold, design: .rounded))
          TextField("Name", text: $name).textFieldStyle(.roundedBorder)
          TextField("Username", text: $username).textFieldStyle(.roundedBorder)
            .autocorrectionDisabled()
          MainButton(title: "Meet your map") {
            store.run {
              store.me = try await store.call(
                "me", "PATCH", ["name": .string(name), "username": .string(username)])
              store.onboardingComplete = true
              await store.bootstrap()
            }
          }.disabled(
            name.isEmpty
              || username.range(of: "^[a-z0-9_.]{3,20}$", options: .regularExpression) == nil)
        }
      }.padding(28).padding(.bottom, 40)
    }
  }
  func loadDeck() async {
    do { deck = try await store.call("onboarding/deck")["cards"].list } catch {
      store.error = error.localizedDescription
    }
  }
  func choose(_ card: JSON, _ liked: Bool, _ count: Int) {
    swipes.append(["cardId": card["id"], "liked": .bool(liked)])
    cardIndex += 1
    if cardIndex >= count { step = 2 }
  }
}
struct SettingsSheet: View {
  @EnvironmentObject var store: CairnStore
  @State var confirmDelete = false
  var body: some View {
    VStack(alignment: .leading, spacing: 25) {
      Text("A little space for you.").font(.system(size: 27, weight: .bold, design: .rounded))
      Button("Edit profile") { store.sheet = "edit" }
      Toggle(
        "Ghost mode",
        isOn: Binding(get: { store.me["ghostMode"].flag }, set: { v in patch("ghostMode", v) }))
      Text("Keep your check-ins off your friends' map.").font(.caption).foregroundStyle(Theme.muted)
      Toggle(
        "Open to plans",
        isOn: Binding(get: { store.me["openToPlans"].flag }, set: { v in patch("openToPlans", v) }))
      Text("Let verified students invite you to something good.").font(.caption).foregroundStyle(
        Theme.muted)
      Button("Bind your personal tag") { store.sheet = "tag" }
      Divider()
      Button("Connection") { store.sheet = "connection" }
      if store.preview {
        Button("Preview a gust of wind") {
          let n = max(0, store.profile["score"]["score"].int - 225)
          store.profile = store.profile.setting(
            "score", store.profile["score"].setting("score", .number(Double(n))))
          store.sheet = nil
          store.panel = "Profile"
        }
      } else {
        Button("Sign out") { store.signOut() }
        Button("Delete account", role: .destructive) { confirmDelete = true }
      }
    }.alert("Delete your Cairn account?", isPresented: $confirmDelete) {
      Button("Delete account", role: .destructive) {
        store.run {
          _ = try await store.call("me", "DELETE")
          try SessionKeychain.write(nil)
          store.token = nil
          store.signedIn = false
          store.onboardingComplete = false
          store.sheet = nil
        }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This removes your account access. This action cannot be undone in the app.")
    }
  }
  func patch(_ key: String, _ value: Bool) {
    store.run { store.me = try await store.call("me", "PATCH", .object([key: .bool(value)])) }
  }
}
struct EditProfileSheet: View {
  @EnvironmentObject var store: CairnStore
  @State var name = ""
  @State var username = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 22) {
      Text("Hello, you.").font(.system(size: 30, weight: .bold, design: .rounded))
      TextField("Name", text: $name).textFieldStyle(.roundedBorder)
      TextField("Username", text: $username).textFieldStyle(.roundedBorder)
      MainButton(title: "Save changes", icon: "checkmark") {
        store.run {
          store.me = try await store.call(
            "me", "PATCH", ["name": .string(name), "username": .string(username)])
          await store.loadProfile()
          store.sheet = nil
        }
      }.disabled(
        name.isEmpty || username.range(of: "^[a-z0-9_.]{3,20}$", options: .regularExpression) == nil
      )
    }.onAppear {
      name = store.me["name"].text
      username = store.me["username"].text
    }
  }
}
