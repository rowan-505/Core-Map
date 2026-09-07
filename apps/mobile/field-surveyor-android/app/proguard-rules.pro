-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod
-keep class com.coremapmm.fieldsurveyor.** { *; }

-keep class org.maplibre.** { *; }
-dontwarn org.maplibre.**

-keep class androidx.room.** { *; }
-keep class androidx.work.** { *; }
-keep class androidx.camera.** { *; }
-keep class androidx.security.crypto.** { *; }

-keep class okhttp3.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

-keep class io.sentry.** { *; }
-dontwarn io.sentry.**
