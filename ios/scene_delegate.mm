#import <UIKit/UIKit.h>

@interface GeaAppDelegate : UIResponder <UIApplicationDelegate>
@property(nonatomic, strong) UIWindow *window;
@end

@interface FiOTPSceneDelegate : UIResponder <UIWindowSceneDelegate>
@end

@implementation FiOTPSceneDelegate

- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
                 options:(UISceneConnectionOptions *)connectionOptions
{
	(void)session;
	(void)connectionOptions;
	if (![scene isKindOfClass:[UIWindowScene class]]) return;
	id<UIApplicationDelegate> delegate = UIApplication.sharedApplication.delegate;
	if (![delegate isKindOfClass:[GeaAppDelegate class]]) return;
	GeaAppDelegate *geaDelegate = (GeaAppDelegate *)delegate;
	// Gea's existing UIKit host builds the root view during didFinishLaunching.
	// Attach that same window to the required UIWindowScene instead of creating
	// a second window or reinitializing the Gea application/runtime.
	geaDelegate.window.windowScene = (UIWindowScene *)scene;
	[geaDelegate.window makeKeyAndVisible];
}

@end
