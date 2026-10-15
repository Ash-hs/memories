Pod::Spec.new do |s|
  s.name = 'MemoriesVideo'
  s.version = '1.0.0'
  s.summary = 'Local offline encoding for Memories'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Memories'
  s.homepage = 'https://expo.dev'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'CoreVideo'
  s.source_files = '**/*.swift'
end
