import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSignIn } from './services';

const queryClient = new QueryClient();

export default () => (
    <QueryClientProvider client={queryClient}>
        <Content />
    </QueryClientProvider>
);

const Content = () => {
    const { mutate, data, error } = useSignIn();

    useEffect(() => {
        mutate({ body: { email: 'vegidio@gmail.com', password: 'password1' } });
    }, [mutate]);

    console.log('data', JSON.stringify(data));
    console.log('error', JSON.stringify(error));

    return (
        <View style={styles.container}>
            <Text>Result: {data?.accessToken}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
