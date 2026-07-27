require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  # NB: must not match the app target name — two identically-named schemes in
  # the workspace make `xcodebuild -scheme <name>` resolve to the pod instead
  # of the app, which "succeeds" while producing an empty .app.
  s.name         = "PreText"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = "nexigenjs"

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => ".git", :tag => "#{s.version}" }

  s.source_files = [
    "ios/**/*.{swift}",
    "ios/**/*.{m,mm}",
    "cpp/**/*.{hpp,cpp}",
  ]

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'

  load 'nitrogen/generated/ios/PreText+autolinking.rb'
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end
